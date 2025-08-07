import { ComponentFactory, GraphBuilder, NodeFactory } from '@inworld/runtime/graph';
import { v4 as uuidv4 } from 'uuid';

export class SimpleAudioProcessor {
  private audioBuffer: Float32Array[] = [];
  private sttComponent: any;
  private sttNode: any;
  private executor: any;
  private isProcessing = false;
  private isReady = false;

  constructor(private apiKey: string) {
    // Delay initialization slightly to avoid rapid creation
    setTimeout(() => this.initializeSTT(), 100);
  }

  private async initializeSTT() {
    console.log('🔊 Initializing STT components...');
    
    // Create STT component
    this.sttComponent = ComponentFactory.createRemoteSTTComponent({
      id: `stt_component_${Date.now()}`,
      sttConfig: {
        apiKey: this.apiKey,
        defaultConfig: {},
      },
    });

    // Create STT node
    this.sttNode = NodeFactory.createRemoteSTTNode({
      id: `stt_node_${Date.now()}`,
      sttComponentId: this.sttComponent.id,
    });

    // Build simple STT graph
    this.executor = new GraphBuilder(`simple_stt_graph_${Date.now()}`)
      .addComponent(this.sttComponent)
      .addNode(this.sttNode)
      .setStartNode(this.sttNode)
      .setEndNode(this.sttNode)
      .getExecutor();

    console.log('✅ STT components ready');
    this.isReady = true;
  }

  addAudioChunk(base64Audio: string) {
    try {
      // Convert base64 to Float32Array
      const binaryString = Buffer.from(base64Audio, 'base64').toString('binary');
      const bytes = new Uint8Array(binaryString.length);
      
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert Int16Array to Float32Array
      const int16Array = new Int16Array(bytes.buffer);
      const floatArray = new Float32Array(int16Array.length);
      
      for (let i = 0; i < int16Array.length; i++) {
        floatArray[i] = int16Array[i] / 32768.0; // Normalize to [-1, 1]
      }

      // Add to buffer
      this.audioBuffer.push(floatArray);
      
      // Keep only last 100 chunks (roughly 6-7 seconds at typical chunk sizes)
      if (this.audioBuffer.length > 100) {
        this.audioBuffer = this.audioBuffer.slice(-100);
      }

      // Simple speech detection: check if we have enough audio and it's not too quiet
      const hasEnoughAudio = this.audioBuffer.length >= 20; // ~1-2 seconds
      const isNotTooQuiet = this.checkAudioLevel(floatArray);

      if (hasEnoughAudio && isNotTooQuiet && !this.isProcessing && this.isReady) {
        this.processAccumulatedAudio();
      }

    } catch (error) {
      console.error('Error processing audio chunk:', error);
    }
  }

  private checkAudioLevel(audioChunk: Float32Array): boolean {
    // Simple volume check
    let sum = 0;
    for (let i = 0; i < audioChunk.length; i++) {
      sum += Math.abs(audioChunk[i]);
    }
    const avgVolume = sum / audioChunk.length;
    const hasSound = avgVolume > 0.005; // Lower threshold
    // console.log(`Audio level: ${avgVolume.toFixed(6)}, has sound: ${hasSound}`);
    return hasSound;
  }

  private async processAccumulatedAudio() {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    console.log('🎤 Processing accumulated audio...');

    try {
      // Combine all buffered audio
      const totalLength = this.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
      const combinedAudio = new Float32Array(totalLength);
      
      let offset = 0;
      for (const chunk of this.audioBuffer) {
        combinedAudio.set(chunk, offset);
        offset += chunk.length;
      }

      console.log(`Processing ${combinedAudio.length} audio samples...`);

      // Send to STT
      const outputStream = await this.executor.execute(
        {
          data: Array.from(combinedAudio), // Convert to number array for STT
          sampleRate: 16000,
        },
        uuidv4(),
      );

      let transcription = '';
      let chunk = await outputStream.next();

      while (!chunk.done) {
        console.log(chunk.type)
        console.log(chunk)
        if (chunk.data) {
          transcription += chunk.data;
        }
        chunk = await outputStream.next();
      }

      if (transcription.trim()) {
        console.log(`Transcription: "${transcription}"`);
        // TODO: Send transcription to client
        return transcription;
      } else {
        console.log('📝 No speech detected in audio');
      }

      // Clear buffer after processing
      this.audioBuffer = [];

    } catch (error) {
      console.error('Error processing audio:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  destroy() {
    if (this.executor) {
      this.executor.cleanupAllExecutions();
      this.executor.destroy();
    }
  }
}