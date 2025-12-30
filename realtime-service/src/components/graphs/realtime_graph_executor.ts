import { GraphOutputStream, GraphTypes } from '@inworld/runtime/graph';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../logger';
import * as RT from '../../types/realtime';
import { InworldApp } from '../app';
import { RealtimeEventFactory } from '../realtime/realtime_event_factory';
import { InworldGraphWrapper } from '../graphs/graph';
import { Connection } from '../../types/index';
import { convertToPCM16Base64 } from '../audio/audio_utils';
import { ToolCallInterface } from "@inworld/runtime";
import { RealtimeSessionManager } from '../realtime/realtime_session_manager';
import { MultimodalStreamManager } from '../audio/multimodal_stream_manager';
import { abortStream } from '../../helpers';

// Marker used to signal tool call continuation - the graph nodes recognize this
// and skip adding a new user message, instead continuing with existing conversation state
export const TOOL_CALL_CONTINUATION_MARKER = '[TOOL_CALL_CONTINUATION]';

export class RealtimeGraphExecutor {
  private isCancelled = false;
  private currentTTSInteractionId: string | null = null;
  private currentTranscriptionItemId: string | null = null;
  private partialTranscripts: Map<string, string> = new Map();

  constructor(
    private inworldApp: InworldApp,
    private sessionKey: string,
    private send: (data: RT.ServerEvent) => void,
    private sessionManager: RealtimeSessionManager,
    private sessionStartTime: number
  ) { }

  cancelCurrentResponse(reason: 'turn_detected' | 'client_cancelled'): void {
    const realtimeSession = this.sessionManager.getSession();
    if (!realtimeSession.currentResponse || this.isCancelled) {
      return; // Nothing to cancel or already cancelled
    }
    logger.info({
      sessionId: this.sessionKey,
      reason,
      responseId: realtimeSession.currentResponse.id,
      ttsInteractionId: this.currentTTSInteractionId || 'none',
    }, 'Response Cancellation');

    this.isCancelled = true;
    const response = realtimeSession.currentResponse;

    // Abort active content and TTS streams
    abortStream(realtimeSession.currentContentStream, 'content stream', this.sessionKey, 'due to response cancellation');
    realtimeSession.currentContentStream = null;

    abortStream(realtimeSession.currentTTSStream, 'TTS stream', this.sessionKey, 'due to response cancellation');
    realtimeSession.currentTTSStream = null;

    response.status = 'cancelled';
    response.status_details = { type: 'cancelled', reason };

    this.send(RealtimeEventFactory.responseDone(response));
    realtimeSession.currentResponse = null;
  }

  /**
   * Execute audio graph with streaming multimodal input (audio and/or text)
   */
  async executeAudioGraph({
    sessionId,
    workspaceId,
    apiKey,
    input,
    graphWrapper,
    multimodalStreamManager,
  }: {
    sessionId: string;
    workspaceId: string;
    apiKey: string;
    input: { sessionId: string; state: any };
    graphWrapper: InworldGraphWrapper;
    multimodalStreamManager: MultimodalStreamManager;
  }): Promise<void> {
    // Create a multimodal stream generator that yields MultimodalContent
    async function* multimodalStreamGenerator() {
      for await (const content of multimodalStreamManager.createStream()) {
        yield content;
      }
    }

    // Create the tagged stream with metadata
    const taggedStream = Object.assign(multimodalStreamGenerator(), {
      type: 'MultimodalContent',
    });

    const { outputStream } = await graphWrapper.graph.start(taggedStream, {
      executionId: input.sessionId,
      dataStoreContent: {
        sessionId: input.sessionId,
        state: input.state,
      },
      userContext: {
        attributes: {
          workspaceId: workspaceId,
        },
        targetingKey: uuidv4(),
      },
      userCredentials: {
        inworldApiKey: apiKey,
      },
    });

    const connection = this.inworldApp.connections[sessionId];
    if (!connection) {
      logger.debug({ sessionId }, 'Connection no longer exists, aborting audio graph execution');
      outputStream.abort();
      return;
    }

    // Store the execution stream so it can be aborted if needed
    connection.currentAudioExecutionStream = outputStream;

    // Handle multiple interactions from the stream
    try {
      let currentGraphInteractionId: string | undefined = undefined;
      let resultCount = 0;

      for await (const result of outputStream) {
        resultCount++;
        logger.debug({ sessionId, resultCount }, `Processing audio interaction #${resultCount}`);

        // Check if result contains an error
        if (result && result.isGraphError && result.isGraphError()) {
          const errorData = result.data;
          logger.error({
            sessionId,
            err: errorData,
          }, 'Graph error');
          if (!errorData.message.includes('recognition produced no text')) {
            this.send(
              RealtimeEventFactory.error({
                type: 'graph_error',
                message: errorData.message,
              }),
            );
            if (errorData.code === 4) {
              const connection = this.inworldApp.connections[sessionId];
              if (connection?.ws) {
                // Close the websocket connection
                // Using code 1011 (Internal Error) as it's a server-side error
                connection.ws.close(1011, 'JS Call Timeout. We will end the call if the audio stream is not active in 60 seconds.');
              }
            }
          }
          continue;
        }

        // Process the result - this will handle transcription, LLM response, and TTS
        await this.processAudioGraphOutput(
          result,
          connection,
          sessionId,
          currentGraphInteractionId,
        );
      }

      logger.info({ sessionId, resultCount }, `Audio stream processing complete: ${resultCount} interactions`);
    } catch (error) {
      logger.error({ err: error, sessionId }, 'Error processing audio stream');
      throw error;
    } finally {
      // Clear the stream reference when done (if connection still exists)
      const conn = this.inworldApp.connections[sessionId];
      if (conn && conn.currentAudioExecutionStream === outputStream) {
        conn.currentAudioExecutionStream = undefined;
      }
      // Clean up stream manager
      connection.multimodalStreamManager = undefined;
      connection.currentAudioGraphExecution = undefined;
    }
  }

  /**
   * Process a single result from the audio graph
   */
  private async processAudioGraphOutput(
    result: any,
    connection: Connection,
    sessionId: string,
    currentGraphInteractionId: string | undefined,
  ): Promise<void> {
    try {
      logger.debug({
        sessionId,
        handlers: Object.keys(result),
      }, 'Audio Graph Result - Processing result');

      const realtimeSession = this.sessionManager.getSession();

      await result.processResponse({
        Content: async (content: GraphTypes.Content) => {
          logger.debug({
            sessionId,
            hasContent: !!content.content,
            contentLength: content.content?.length,
            hasToolCalls: !!content.toolCalls,
            toolCallsCount: content.toolCalls?.length,
          }, 'Audio Graph - Content received');

          if (content.toolCalls && content.toolCalls.length > 0) {
            logger.info({ sessionId, toolCalls: content.toolCalls }, `Audio Graph - ${content.toolCalls.length} tool calls received`);
          }
        },
        ContentStream: async (stream: GraphTypes.ContentStream) => {
          // Ensure we have a response object
          if (!realtimeSession.currentResponse) {
            const responseId = uuidv4();
            const response: RT.Response = {
              id: responseId,
              object: 'realtime.response',
              status: 'in_progress',
              status_details: null,
              output: [],
              conversation_id: 'conv_' + realtimeSession.id,
              output_modalities: realtimeSession.session.output_modalities,
              max_output_tokens: realtimeSession.session.max_output_tokens,
              audio: {
                output: realtimeSession.session.audio.output,
              },
              usage: null,
              metadata: null,
            };
            realtimeSession.currentResponse = response;
            this.send(RealtimeEventFactory.responseCreated(response));
          }

          await this.handleContentStream(stream, realtimeSession.currentResponse!, connection);
        },
        TTSOutputStream: async (ttsStream: GraphTypes.TTSOutputStream) => {
          // Create a response if we don't have one
          if (!realtimeSession.currentResponse) {
            const responseId = uuidv4();
            const response: RT.Response = {
              id: responseId,
              object: 'realtime.response',
              status: 'in_progress',
              status_details: null,
              output: [],
              conversation_id: 'conv_' + realtimeSession.id,
              output_modalities: realtimeSession.session.output_modalities,
              max_output_tokens: realtimeSession.session.max_output_tokens,
              audio: {
                output: realtimeSession.session.audio.output,
              },
              usage: null,
              metadata: null,
            };
            realtimeSession.currentResponse = response;
            this.send(RealtimeEventFactory.responseCreated(response));
          }

          await this.handleTTSOutputStream(ttsStream, realtimeSession.currentResponse!, connection, 'Audio Input');
        },
        TextStream: async (stream: GraphTypes.TextStream) => {
          // Create a response if we don't have one
          if (!realtimeSession.currentResponse) {
            const responseId = uuidv4();
            const response: RT.Response = {
              id: responseId,
              object: 'realtime.response',
              status: 'in_progress',
              status_details: null,
              output: [],
              conversation_id: 'conv_' + realtimeSession.id,
              output_modalities: realtimeSession.session.output_modalities,
              max_output_tokens: realtimeSession.session.max_output_tokens,
              audio: {
                output: realtimeSession.session.audio.output,
              },
              usage: null,
              metadata: null,
            };
            realtimeSession.currentResponse = response;
            this.send(RealtimeEventFactory.responseCreated(response));
          }
          await this.handleTextOutputStream(stream, realtimeSession.currentResponse!, connection, 'Audio Input');
        },
        Custom: async (customData: GraphTypes.Custom<any>) => {
          // Handle custom events (transcription, etc)

          // Check if it's a transcription event
          if (('text' in customData || customData.type === 'TRANSCRIPT') && !('messages' in customData)) {
            const transcript = (customData as any).text || '';
            const interactionId = (customData as any).interactionId;
            const isTextInput = (customData as any).is_text_input === true;

            // Skip tool continuation marker - this is an internal marker, not a real transcript
            if (transcript === TOOL_CALL_CONTINUATION_MARKER) {
              logger.info({ sessionId, interactionId }, 
                'Skipping transcription event for tool call continuation marker');
              return;
            }

            if (transcript && transcript.trim().length > 0) {
              const itemId = interactionId || uuidv4();
              
              // Check if this is a text input (simulated) - if so, skip transcription events
              // Text inputs already have their conversation item created before being pushed to the graph
              // We check:
              // 1. If is_text_input flag is set in customData
              // 2. If a conversation item with matching text already exists (text inputs create items first)
              // 3. If the most recent user message matches this transcript (text inputs are processed immediately)
              const existingItem = realtimeSession.conversationItems.find(
                item => item.id === itemId || 
                (item.role === 'user' && 
                 item.content?.[0]?.type === 'input_text' && 
                 item.content[0].text === transcript)
              );
              
              // Also check the most recent user message (text inputs are typically the last item)
              const lastUserItem = realtimeSession.conversationItems.length > 0
                ? realtimeSession.conversationItems[realtimeSession.conversationItems.length - 1]
                : null;
              const isRecentTextInput = lastUserItem?.role === 'user' &&
                lastUserItem?.content?.[0]?.type === 'input_text' &&
                lastUserItem.content[0].text === transcript;

              if (isTextInput || existingItem || isRecentTextInput) {
                // This is a text input that was already processed
                // Skip all transcription events since the conversation item already exists
                logger.info({ sessionId, itemId, transcript: transcript.substring(0, 50) }, 
                  `Skipping transcription events for text input (conversation item already exists)`);
                return;
              }

              const audioStartMs = Date.now() - this.sessionStartTime;

              // Send speech started event if we haven't already
              if (!this.currentTranscriptionItemId) {
                this.send(
                  RealtimeEventFactory.inputAudioBufferSpeechStarted(audioStartMs, itemId),
                );
              }

              this.currentTranscriptionItemId = itemId;

              // Send speech stopped event
              const audioEndMs = Date.now() - this.sessionStartTime;
              this.send(
                RealtimeEventFactory.inputAudioBufferSpeechStopped(audioEndMs, itemId),
              );

              const previousItemId =
                realtimeSession.conversationItems.length > 0
                  ? realtimeSession.conversationItems[
                    realtimeSession.conversationItems.length - 1
                  ].id
                  : null;

              // Send committed event
              this.send(
                RealtimeEventFactory.inputAudioBufferCommitted(itemId, previousItemId),
              );

              // Create conversation item for user transcription
              const item: RT.ConversationItem = {
                id: itemId,
                type: 'message',
                object: 'realtime.item',
                status: 'completed',
                role: 'user',
                content: [
                  {
                    type: 'input_text',
                    text: transcript,
                  },
                ],
              };

              realtimeSession.conversationItems.push(item);
              this.send(RealtimeEventFactory.conversationItemAdded(item, previousItemId));

              // Send transcription completed event
              logger.info({ sessionId, transcript, itemId }, `Transcription completed: "${transcript.substring(0, 50)}..."`);
              this.send(
                RealtimeEventFactory.inputAudioTranscriptionCompleted(
                  itemId,
                  0,
                  transcript,
                ),
              );

              this.send(RealtimeEventFactory.conversationItemDone(item, previousItemId));

              // Clear the transcription item ID
              this.currentTranscriptionItemId = null;
              this.partialTranscripts.delete(itemId);
            }
          }
        },
        error: async (error: GraphTypes.GraphError) => {
          logger.error({ sessionId, err: error }, 'Graph error');
          // Don't send errors for empty speech recognition
          if (!error.message.includes('recognition produced no text')) {
            this.send(
              RealtimeEventFactory.error({
                type: 'server_error',
                message: error.message,
              }),
            );
          }
        },
      });
    } catch (error) {
      logger.error({ sessionId, err: error }, 'Error processing audio graph result');
      this.send(
        RealtimeEventFactory.error({
          type: 'server_error',
          message: error instanceof Error ? error.message : 'Unknown error processing audio graph result',
        }),
      );
    }
  }

  /**
   * Process ContentStream for tool calls (shared between audio and text graphs)
   */
  private async handleContentStream(
    stream: GraphTypes.ContentStream,
    response: RT.Response,
    connection: Connection,
  ): Promise<void> {
    const realtimeSession = this.sessionManager.getSession();
    const toolCallState = new Map<string, { item: RT.ConversationItem; args: string }>();

    // Store the stream object so it can be aborted
    realtimeSession.currentContentStream = stream;

    try {
      for await (const chunk of stream) {
        if (chunk.toolCalls && chunk.toolCalls.length > 0) {
          await this.handleToolCallChunk(chunk.toolCalls, response, toolCallState);
        }
      }
    } finally {
      // Clear the stream reference when done
      realtimeSession.currentContentStream = null;
    }

    // Send completion events for all tool calls
    for (const [callId, state] of toolCallState.entries()) {
      const outputIndex = response.output.indexOf(state.item);

      // Update the item with final arguments
      state.item.arguments = state.args;
      state.item.status = 'completed';

      // Send done event
      this.send(
        RealtimeEventFactory.responseFunctionCallArgumentsDone(
          response.id,
          state.item.id!,
          outputIndex,
          callId,
          state.args,
        ),
      );

      this.send(
        RealtimeEventFactory.conversationItemDone(state.item),
      );

      this.send(
        RealtimeEventFactory.responseOutputItemDone(
          response.id,
          outputIndex,
          state.item,
        ),
      );

      // Add to conversation items
      realtimeSession.conversationItems.push(state.item);

      // Add a minimal assistant message
      connection.state.messages.push({
        role: 'assistant',
        content: '[Function call executed]',
        id: connection.state.interactionId,
      });
    }
  }

  /**
   * Process TextOutputStream for text-only messages
   */
  private async handleTextOutputStream(
    stream: GraphTypes.TextStream,
    response: RT.Response,
    connection: Connection,
    logPrefix: string,
  ): Promise<RT.ConversationItem | undefined> {
    const realtimeSession = this.sessionManager.getSession();
    const isTextOnly =
      response.output_modalities?.includes('text') &&
      !response.output_modalities?.includes('audio');

    let item: RT.ConversationItem | undefined;
    let itemId: string | undefined;
    let outputIndex: number | undefined;
    let contentPart: RT.ContentPart | undefined;
    const contentIndex = 0;

    if (!isTextOnly) {
      logger.info('[Text Output Stream] should not be called when modality is not text only!');
      return item;
    }

    // Process text stream chunks
    for await (const chunk of stream) {
      // Extract text from chunk (handle both string and object with text property)
      const text = typeof chunk === 'string' ? chunk : (chunk?.text || chunk?.toString() || '');

      if (!text || text === '') {
        continue;
      }

      // Lazy create item on first chunk
      if (!item) {
        itemId = uuidv4();
        outputIndex = response.output.length;

        item = {
          id: itemId,
          type: 'message',
          object: 'realtime.item',
          status: 'in_progress',
          role: 'assistant',
          content: [],
        };

        const previousItemId =
          realtimeSession.conversationItems.length > 0
            ? realtimeSession.conversationItems[
              realtimeSession.conversationItems.length - 1
            ].id
            : null;

        response.output.push(item);
        this.send(
          RealtimeEventFactory.responseOutputItemAdded(response.id, outputIndex, item),
        );
        this.send(
          RealtimeEventFactory.conversationItemAdded(item, previousItemId),
        );

        contentPart = { type: 'text', text: '' };

        item.content = [contentPart];
        this.send(
          RealtimeEventFactory.responseContentPartAdded(
            response.id,
            itemId,
            outputIndex,
            contentIndex,
            contentPart,
          ),
        );

        // Track that we're streaming text for this interaction
        const textInteractionId = connection.state.interactionId;
        this.isCancelled = false;

        logger.info({ sessionId: this.sessionKey, textInteractionId, logPrefix }, `Text stream starting (${logPrefix})`);
      }

      if (this.isCancelled) {
        logger.info(`[Text Output] Stopping text stream - response was cancelled`);
        break;
      }

      // Send text delta event
      this.send(
        RealtimeEventFactory.responseTextDelta(
          response.id,
          itemId!,
          outputIndex!,
          contentIndex,
          text,
        ),
      );
      // logger.info(`[TEXT DELTA] - ${text}`);
      contentPart!.text = (contentPart!.text || '') + text;
    }

    // Send completion events or mark as incomplete
    if (item) {
      if (this.isCancelled) {
        item.status = 'incomplete';
      } else {
        const previousItemId =
          realtimeSession.conversationItems.length > 0
            ? realtimeSession.conversationItems[
              realtimeSession.conversationItems.length - 1
            ].id
            : null;

        // Send text completion event
        this.send(RealtimeEventFactory.responseTextDone(
          response.id, itemId!, outputIndex!, contentIndex, contentPart!.text || ''
        ));

        // Send common completion events
        this.send(RealtimeEventFactory.responseContentPartDone(
          response.id, itemId!, outputIndex!, contentIndex, contentPart!
        ));
        this.send(RealtimeEventFactory.conversationItemDone(item, previousItemId));

        item.status = 'completed';
        this.send(RealtimeEventFactory.responseOutputItemDone(response.id, outputIndex!, item));
      }

      // Add to conversation items
      realtimeSession.conversationItems.push(item);
    }

    return item;
  }

  /**
   * Process TTSOutputStream for audio messages
   * Note: Text-only modality is handled by handleTextOutputStream
   */
  private async handleTTSOutputStream(
    ttsStream: GraphTypes.TTSOutputStream,
    response: RT.Response,
    connection: Connection,
    logPrefix: string,
  ): Promise<RT.ConversationItem | undefined> {
    const realtimeSession = this.sessionManager.getSession();
    const isTextOnly =
      response.output_modalities?.includes('text') &&
      !response.output_modalities?.includes('audio');

    // Warn if called with text-only modality (should use handleTextOutputStream instead)
    if (isTextOnly) {
      logger.warn('[TTS Output Stream] Called with text-only modality - should use handleTextOutputStream instead');
    }

    let item: RT.ConversationItem | undefined;
    let itemId: string | undefined;
    let outputIndex: number | undefined;
    let contentPart: RT.ContentPart | undefined;
    const contentIndex = 0;

    // Store the TTSOutputStream object so it can be aborted using its abort() method
    realtimeSession.currentTTSStream = ttsStream;

    try {
      // Process TTS stream chunks
      for await (const chunk of ttsStream) {
        // Lazy create item on first chunk
        if (!item) {
          itemId = uuidv4();
          outputIndex = response.output.length;

          item = {
            id: itemId,
            type: 'message',
            object: 'realtime.item',
            status: 'in_progress',
            role: 'assistant',
            content: [],
          };

          const previousItemId =
            realtimeSession.conversationItems.length > 0
              ? realtimeSession.conversationItems[
                realtimeSession.conversationItems.length - 1
              ].id
              : null;

          response.output.push(item);
          this.send(
            RealtimeEventFactory.responseOutputItemAdded(response.id, outputIndex, item),
          );
          this.send(
            RealtimeEventFactory.conversationItemAdded(item, previousItemId),
          );

          // Always create audio content part (text-only is handled elsewhere)
          contentPart = { type: 'audio', transcript: '' };

          item.content = [contentPart];
          this.send(
            RealtimeEventFactory.responseContentPartAdded(
              response.id,
              itemId,
              outputIndex,
              contentIndex,
              contentPart,
            ),
          );

          // Track that we're streaming TTS for this interaction
          const ttsInteractionId = connection.state.interactionId;
          this.currentTTSInteractionId = ttsInteractionId;
          this.isCancelled = false;

          logger.info(`[TTS] Starting stream for ${ttsInteractionId} (${logPrefix})`);
        }

        if (this.isCancelled) {
          logger.info(`[TTS] Stopping TTS stream - response was cancelled`);
          break;
        }

        // Process audio chunk
        if (chunk.text != null && chunk.text !== '') {
          this.send(
            RealtimeEventFactory.responseAudioTranscriptDelta(
              response.id,
              itemId!,
              outputIndex!,
              contentIndex,
              chunk.text,
            ),
          );
        }

        // Convert audio data to PCM16 base64
        const audioBase64 = convertToPCM16Base64(
          chunk.audio?.data,
          chunk.audio?.sampleRate,
          `TTS Audio (${logPrefix})`
        );

        if (!audioBase64) {
          continue;
        }

        // Send audio delta
        this.send(
          RealtimeEventFactory.responseAudioDelta(
            response.id,
            itemId!,
            outputIndex!,
            contentIndex,
            audioBase64,
          ),
        );

        // Update transcript
        if (chunk.text) {
          contentPart!.transcript = (contentPart!.transcript || '') + chunk.text;
        }
      }

      // Send completion events or mark as incomplete
      if (item) {
        if (this.isCancelled) {
          item.status = 'incomplete';
        } else {
          const previousItemId =
            realtimeSession.conversationItems.length > 0
              ? realtimeSession.conversationItems[
                realtimeSession.conversationItems.length - 1
              ].id
              : null;

          // Send audio completion events
          this.send(RealtimeEventFactory.responseAudioTranscriptDone(
            response.id, itemId!, outputIndex!, contentIndex, contentPart!.transcript || ''
          ));
          this.send(RealtimeEventFactory.responseAudioDone(
            response.id, itemId!, outputIndex!, contentIndex
          ));

          // Send common completion events
          this.send(RealtimeEventFactory.responseContentPartDone(
            response.id, itemId!, outputIndex!, contentIndex, contentPart!
          ));
          this.send(RealtimeEventFactory.conversationItemDone(item, previousItemId));

          item.status = 'completed';
          this.send(RealtimeEventFactory.responseOutputItemDone(response.id, outputIndex!, item));

          // Clear TTS tracking on successful completion
          this.currentTTSInteractionId = null;
        }

        // Add to conversation items
        realtimeSession.conversationItems.push(item);
      }

      return item;
    } catch (error) {
      // Check if this is a cancellation error (expected when response is cancelled)
      const isCancellationError =
        this.isCancelled &&
        error instanceof Error &&
        error.message.includes('Operation cancelled');

      if (isCancellationError) {
        logger.debug({ sessionId: this.sessionKey }, 'TTS stream cancelled (expected during response cancellation)');

        // Mark item as incomplete if we had started creating one
        if (item) {
          item.status = 'incomplete';
          realtimeSession.conversationItems.push(item);
        }
        return item;
      }

      // Re-throw unexpected errors
      throw error;
    } finally {
      // Clear the stream reference when done
      realtimeSession.currentTTSStream = null;
    }
  }

  /**
   * Handle tool call chunks from LLM stream
   */
  private async handleToolCallChunk(
    toolCalls: ToolCallInterface[],
    response: RT.Response,
    toolCallState: Map<string, { item: RT.ConversationItem; args: string }>,
  ): Promise<void> {
    for (const toolCall of toolCalls) {
      const callId = toolCall.id;

      if (!toolCallState.has(callId)) {
        // New tool call
        const itemId = uuidv4();
        const outputIndex = response.output.length;
        const item: RT.ConversationItem = {
          id: itemId,
          type: 'function_call',
          object: 'realtime.item',
          status: 'in_progress',
          call_id: callId,
          name: toolCall.name,
          arguments: '',
        };

        response.output.push(item);
        this.send(
          RealtimeEventFactory.responseOutputItemAdded(
            response.id,
            outputIndex,
            item,
          ),
        );
        this.send(RealtimeEventFactory.conversationItemAdded(item));

        toolCallState.set(callId, { item, args: toolCall.args || '' });

        if (toolCall.args) {
          this.send(
            RealtimeEventFactory.responseFunctionCallArgumentsDelta(
              response.id,
              item.id!,
              outputIndex,
              callId,
              toolCall.args,
            ),
          );
        }
      } else {
        // Existing tool call
        const state = toolCallState.get(callId)!;

        if (toolCall.args) {
          state.args += toolCall.args;

          const outputIndex = response.output.indexOf(state.item);

          this.send(
            RealtimeEventFactory.responseFunctionCallArgumentsDelta(
              response.id,
              state.item.id!,
              outputIndex,
              callId,
              toolCall.args,
            ),
          );
        }
      }
    }
  }

  /**
   * Handle partial transcription updates from AssemblyAI.
   */
  handlePartialTranscriptDelta(
    interactionId: string,
    text: string,
  ): void {
    if (!interactionId || typeof text !== 'string') {
      return;
    }

    const previous = this.partialTranscripts.get(interactionId) ?? '';

    if (text === previous) {
      return;
    }

    // Track that this interaction is the active transcription
    this.currentTranscriptionItemId = interactionId;

    // Compute the longest common prefix to determine the delta
    const commonPrefixLength = this.getCommonPrefixLength(previous, text);
    const deletions = previous.length - commonPrefixLength;
    let delta = '';

    if (deletions > 0) {
      delta += '\b'.repeat(deletions);
    }

    delta += text.slice(commonPrefixLength);

    if (!delta) {
      return;
    }

    this.partialTranscripts.set(interactionId, text);

    this.send(
      RealtimeEventFactory.inputAudioTranscriptionDelta(
        interactionId,
        0,
        delta,
      ),
    );
  }

  private getCommonPrefixLength(a: string, b: string): number {
    const maxLen = Math.min(a.length, b.length);
    let idx = 0;
    while (idx < maxLen && a[idx] === b[idx]) {
      idx++;
    }
    return idx;
  }

  /**
   * Create a response from the model
   */
  async createResponse(inputItemId?: string): Promise<void> {
    // Reset cancellation flag for new response
    this.isCancelled = false;

    const realtimeSession = this.sessionManager.getSession();
    const responseId = uuidv4();
    const response: RT.Response = {
      id: responseId,
      object: 'realtime.response',
      status: 'in_progress',
      status_details: null,
      output: [],
      conversation_id: 'conv_' + realtimeSession.id,
      output_modalities: realtimeSession.session.output_modalities,
      max_output_tokens: realtimeSession.session.max_output_tokens,
      audio: {
        output: realtimeSession.session.audio.output,
      },
      usage: null,
      metadata: null,
    };

    realtimeSession.currentResponse = response;
    this.send(RealtimeEventFactory.responseCreated(response));

    try {
      const connection = this.inworldApp.connections[this.sessionKey];
      
      // Check if this is a tool call continuation (response.create after function_call_output)
      const lastItem = realtimeSession.conversationItems.length > 0
        ? realtimeSession.conversationItems[realtimeSession.conversationItems.length - 1]
        : null;
      
      const isToolCallContinuation = lastItem?.type === 'function_call_output';
      
      if (isToolCallContinuation) {
        // This is a continuation after a tool call - the tool result is already in connection.state.messages
        // We need to trigger the LLM with the current conversation state
        logger.info({ sessionId: this.sessionKey, callId: lastItem.call_id }, 'Tool call continuation - triggering LLM with tool result');
        
        if (!connection) {
          throw new Error('No connection found for session');
        }
        
        // Trigger the LLM via the audio graph with a tool continuation marker
        // This will be recognized by the graph and processed without adding a new user message
        await this.handleToolCallContinuation(connection, response);
        return;
      }

      // Find the most recent user message to process
      let userMessage: RT.ConversationItem | undefined;

      if (inputItemId) {
        userMessage = realtimeSession.conversationItems.find(
          (i) => i.id === inputItemId,
        );
      } else {
        // Find the last user message
        for (let i = realtimeSession.conversationItems.length - 1; i >= 0; i--) {
          const item = realtimeSession.conversationItems[i];
          if (item.role === 'user') {
            userMessage = item;
            break;
          }
        }
      }

      if (!userMessage || !userMessage.content || userMessage.content.length === 0) {
        // Send error event instead of throwing
        response.status = 'failed';
        response.status_details = {
          type: 'failed',
          error: {
            type: 'invalid_request_error',
            code: 'no_user_message',
          },
        };
        this.send(RealtimeEventFactory.responseDone(response));
        this.send(
          RealtimeEventFactory.error({
            type: 'invalid_request_error',
            code: 'no_user_message',
            message: 'No user message found to generate response. Please create a conversation item before requesting a response.',
          }),
        );
        realtimeSession.currentResponse = null;
        return;
      }

      const content = userMessage.content[0];
      let input: any;

      if (content.type === 'input_text' && content.text) {
        // Text inputs are processed through the continuous multimodal stream
        // The graph runs continuously and automatically sends response events for each turn
        // DO NOT wait for graph completion - it runs until the stream is ended
        const hasActiveAudioGraph = connection?.currentAudioGraphExecution !== undefined;
        
        if (hasActiveAudioGraph) {
          // Graph is running and processing text turns continuously
          // Response events are sent automatically by processAudioGraphOutput
          // Just acknowledge and return - don't block
          logger.info({ sessionId: this.sessionKey, responseId },
            'Text input being processed by continuous graph - response events sent automatically');
        } else {
          // No active graph - text should have been pushed via conversation.item.create first
          logger.warn({ sessionId: this.sessionKey },
            'No active graph for text input - ensure conversation.item.create was called first');
        }

        // Cancel this response.create since the graph handles responses automatically
        this.isCancelled = true;
        realtimeSession.currentResponse = null;
        return;
      } else {
        // For audio input, it should have been handled by the audio graph already?
        // Or if we manually trigger response creation on an existing audio item?
        // If content.type is input_audio, we probably can't easily re-run it through the text graph
        // unless we have the transcript.
        // But the logic in original file threw error.
        throw new Error(`Unsupported content type: ${content.type}`);
      }

      // Don't mark as completed if already cancelled
      if (!this.isCancelled) {
        // Mark response as completed
        response.status = 'completed';
        response.status_details = { type: 'completed' };
      }
    } catch (error) {
      logger.error({ err: error, sessionId: this.sessionKey }, 'Error creating response');
      response.status = 'failed';
      response.status_details = {
        type: 'failed',
        error: {
          type: 'server_error',
          code: 'internal_error',
        },
      };
      // Send error to websocket
      this.send(
        RealtimeEventFactory.error({
          type: 'server_error',
          message: error instanceof Error ? error.message : 'Error creating response',
        }),
      );
    }

    // Only send response.done if not already cancelled
    if (!this.isCancelled) {
      this.send(RealtimeEventFactory.responseDone(response));
      realtimeSession.currentResponse = null;
    }
  }

  /**
   * Handle tool call continuation by triggering the LLM with the current conversation state.
   * The tool result is already in connection.state.messages (added by createConversationItem).
   * This method triggers the graph without adding a new user message.
   */
  private async handleToolCallContinuation(
    connection: Connection,
    response: RT.Response,
  ): Promise<void> {
    const realtimeSession = this.sessionManager.getSession();
    
    try {
      // Create a multimodal stream manager for this continuation
      const multimodalStreamManager = new MultimodalStreamManager();
      connection.multimodalStreamManager = multimodalStreamManager;
      
      const session = realtimeSession.session;
      
      // Start the audio graph execution with the stream
      const audioStreamInput = {
        sessionId: this.sessionKey,
        state: connection.state,
        voiceId: connection.state.voiceId || session.audio.output.voice,
      };
      
      // Use the Assembly.AI audio graph
      const graphWrapper = this.inworldApp.graphWithAudioInput;
      
      // Push a special tool continuation marker that the graph nodes will recognize
      // This signals that we're continuing after a tool call and shouldn't add a new user message
      multimodalStreamManager.pushText(TOOL_CALL_CONTINUATION_MARKER);
      
      // Start graph execution and wait for completion
      connection.currentAudioGraphExecution = this.executeAudioGraph({
        sessionId: this.sessionKey,
        workspaceId: connection.workspaceId,
        apiKey: connection.apiKey,
        input: audioStreamInput,
        graphWrapper,
        multimodalStreamManager,
      });
      
      await connection.currentAudioGraphExecution;
      
      // Response should have been handled by the audio graph output processing
      // Mark as completed if not already done
      if (!this.isCancelled && realtimeSession.currentResponse?.id === response.id) {
        response.status = 'completed';
        response.status_details = { type: 'completed' };
        this.send(RealtimeEventFactory.responseDone(response));
        realtimeSession.currentResponse = null;
      }
    } catch (error) {
      logger.error({ err: error, sessionId: this.sessionKey }, 'Error in tool call continuation');
      response.status = 'failed';
      response.status_details = {
        type: 'failed',
        error: {
          type: 'server_error',
          code: 'tool_continuation_error',
        },
      };
      this.send(RealtimeEventFactory.responseDone(response));
      this.send(
        RealtimeEventFactory.error({
          type: 'server_error',
          message: error instanceof Error ? error.message : 'Error in tool call continuation',
        }),
      );
      realtimeSession.currentResponse = null;
    } finally {
      // Clean up
      connection.multimodalStreamManager = undefined;
      connection.currentAudioGraphExecution = undefined;
    }
  }
}

