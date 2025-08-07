import { ComponentFactory, GraphBuilder, NodeFactory } from '@inworld/runtime/graph';
import { v4 as uuidv4 } from 'uuid';
import { SileroVAD, VADConfig } from './silero-vad.ts';

export class SimpleAudioProcessor {
  private audioBuffer: Float32Array[] = [];
  private sttComponent: any;
  private sttNode: any;
  private executor: any;
  private vad: SileroVAD | null = null;
  private isProcessing = false;
  private isReady = false;
  private websocket: any = null;
  private baselineNoise = { peak: 0, rms: 0 };
  private calibrationSamples: Float32Array[] = [];
  private isCalibrating = false;
  private calibrationStartTime = 0;
  private calibrationDuration = 3000; // 3 seconds

  constructor(private apiKey: string, websocket?: any) {
    this.websocket = websocket;
    setTimeout(() => this.initialize(), 100);
  }


  private async initialize() {
    
    // Initialize VAD first (optional for now)
    try {
      const vadConfig: VADConfig = {
        modelPath: '/Users/cale/code/aprendemo/backend/models/silero_vad.onnx',
        threshold: 0.3,  // Higher threshold to reduce false positives  
        minSpeechDuration: 0.5,  // Longer minimum speech to avoid noise triggers
        minSilenceDuration: 0.8, // Longer silence to ensure complete sentences
        speechResetSilenceDuration: 1.0, // Grace period
        sampleRate: 16000
      };
      
      this.vad = new SileroVAD(vadConfig);
      await this.vad.initialize();
      
      // Set up VAD event listeners
      this.vad.on('speechStart', (event) => {
        console.log(`🎤 VAD: Speech started (confidence: ${event.confidence.toFixed(3)})`);
      });
      
      this.vad.on('speechEnd', async (event) => {
        await this.processVADSpeechSegment(event.speechSegment);
      });
      
      this.vad.on('vadResult', () => {
        // VAD processing
      });
      
      // VAD ready
    } catch (error) {
      console.warn('VAD initialization failed, continuing with volume detection:', error);
      this.vad = null;
    }
    
    // Initialize STT
    await this.initializeSTT();
  }

  private async initializeSTT() {
    
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
    this.executor = new GraphBuilder(`simple_stt_graph`)
      .addComponent(this.sttComponent)
      .addNode(this.sttNode)
      .setStartNode(this.sttNode)
      .setEndNode(this.sttNode)
      .getExecutor();

    // STT ready
    this.isReady = true;
  }

  addAudioChunk(base64Audio: string) {
    try {
      // Convert audio for calibration and processing
      const binaryString = Buffer.from(base64Audio, 'base64').toString('binary');
      const bytes = new Uint8Array(binaryString.length);
      
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const int16Array = new Int16Array(bytes.buffer);
      const floatArray = new Float32Array(int16Array.length);
      
      for (let i = 0; i < int16Array.length; i++) {
        floatArray[i] = int16Array[i]; // Keep as raw integers for energy calculation
      }

      // Start calibration on first audio chunk
      if (!this.isCalibrating && this.baselineNoise.peak === 0) {
        this.startCalibration();
      }

      // Collect calibration data
      if (this.isCalibrating) {
        this.calibrationSamples.push(floatArray);
        
        // Check if calibration period is complete
        if (Date.now() - this.calibrationStartTime >= this.calibrationDuration) {
          this.finishCalibration();
        }
        return; // Don't process during calibration
      }

      // Feed audio directly to VAD if available
      if (this.vad && this.isReady) {
        this.vad.addAudioData(base64Audio);
      }

      // Add to buffer for fallback
      const normalizedArray = new Float32Array(floatArray.length);
      for (let i = 0; i < floatArray.length; i++) {
        normalizedArray[i] = floatArray[i] / 32768.0; // Normalize for fallback
      }

      // Add to buffer (keeping for fallback)
      this.audioBuffer.push(normalizedArray);
      
      // Keep only last 100 chunks
      if (this.audioBuffer.length > 100) {
        this.audioBuffer = this.audioBuffer.slice(-100);
      }

      // Fallback to volume detection if VAD is not available
      if (!this.vad) {
        const hasEnoughAudio = this.audioBuffer.length >= 20;
        const isNotTooQuiet = this.checkAudioLevel(normalizedArray);

        if (hasEnoughAudio && isNotTooQuiet && !this.isProcessing && this.isReady) {
          this.processAccumulatedAudio();
        }
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

  private amplifyAudio(audioData: Float32Array, gain: number): Float32Array {
    // Create a new array for amplified audio
    const amplified = new Float32Array(audioData.length);
    
    // Find peak to prevent clipping
    let maxVal = 0;
    for (let i = 0; i < audioData.length; i++) {
      const absVal = Math.abs(audioData[i]);
      if (absVal > maxVal) {
        maxVal = absVal;
      }
    }
    
    // Determine safe gain to prevent clipping
    const maxIntValue = 32767; // Max Int16 value
    const currentMax = maxVal;
    const safeGain = Math.min(gain, maxIntValue * 0.5 / currentMax); // Leave 10% headroom
    
    // Apply amplification
    for (let i = 0; i < audioData.length; i++) {
      amplified[i] = audioData[i] * safeGain;
    }
    
    // Audio amplified
    
    return amplified;
  }

  private startCalibration() {
    this.isCalibrating = true;
    this.calibrationStartTime = Date.now();
    this.calibrationSamples = [];
    console.log('Starting microphone calibration for 3 seconds...');
  }

  private finishCalibration() {
    if (this.calibrationSamples.length === 0) {
      console.log('No calibration data, using default thresholds');
      this.baselineNoise = { peak: 50, rms: 10 };
      this.isCalibrating = false;
      return;
    }

    // Calculate baseline noise levels
    let totalPeak = 0;
    let totalRms = 0;
    let sampleCount = 0;

    for (const sample of this.calibrationSamples) {
      let sumSquares = 0;
      let peakValue = 0;
      
      for (let i = 0; i < sample.length; i++) {
        const absValue = Math.abs(sample[i]);
        sumSquares += absValue * absValue;
        if (absValue > peakValue) {
          peakValue = absValue;
        }
      }
      
      const rms = Math.sqrt(sumSquares / sample.length);
      totalPeak += peakValue;
      totalRms += rms;
      sampleCount++;
    }

    this.baselineNoise.peak = totalPeak / sampleCount;
    this.baselineNoise.rms = totalRms / sampleCount;
    this.isCalibrating = false;
    
    console.log(`Calibration complete. Baseline: peak=${this.baselineNoise.peak.toFixed(0)}, rms=${this.baselineNoise.rms.toFixed(0)}`);
    
    // Clear calibration data
    this.calibrationSamples = [];
  }

  private hasSignificantAudio(audioData: Float32Array): boolean {
    // Calculate RMS and peak
    let sumSquares = 0;
    let peakValue = 0;
    
    for (let i = 0; i < audioData.length; i++) {
      const sample = Math.abs(audioData[i]);
      sumSquares += sample * sample;
      if (sample > peakValue) {
        peakValue = sample;
      }
    }
    
    const rms = Math.sqrt(sumSquares / audioData.length);
    
    // Dynamic thresholds based on baseline + multiplier
    const peakThreshold = this.baselineNoise.peak * 8; // 8x baseline peak for clear speech
    const rmsThreshold = this.baselineNoise.rms * 10;  // 10x baseline RMS for clear speech
    
    // Use OR condition: either peak OR RMS indicates speech above baseline
    const hasSignificantEnergy = peakValue > peakThreshold || rms > rmsThreshold;
    
    if (!hasSignificantEnergy) {
      console.log(`Rejecting low-energy audio: peak=${peakValue.toFixed(0)}, rms=${rms.toFixed(0)} (need peak>${peakThreshold.toFixed(0)} OR rms>${rmsThreshold.toFixed(0)})`);
    }
    
    return hasSignificantEnergy;
  }

  private async processVADSpeechSegment(speechSegment: Float32Array) {
    if (this.isProcessing) {
      console.log('Already processing audio, skipping VAD segment');
      return;
    }
    
    this.isProcessing = true;
    // Processing VAD speech segment

    // Check if audio has significant energy (not just noise)
    if (!this.hasSignificantAudio(speechSegment)) {
      console.log('Skipping low-energy segment');
      this.isProcessing = false;
      return;
    }

    // Amplify audio for better STT quality
    const amplifiedSegment = this.amplifyAudio(speechSegment, 2.0); // 2x gain

    // Process amplified segment

    try {
      // Send amplified speech segment to STT
      const outputStream = await this.executor.execute(
        {
          data: Array.from(amplifiedSegment), // Convert to number array for STT
          sampleRate: 16000,
        },
        uuidv4(),
      );

      let transcription = '';
      let chunk = await outputStream.next();

      while (!chunk.done) {
        if (chunk.data) {
          transcription += chunk.data;
        }
        chunk = await outputStream.next();
      }

      if (transcription.trim()) {
        console.log(`"${transcription.trim()}"`);
        
        // Send transcription to frontend
        if (this.websocket) {
          this.websocket.send(JSON.stringify({
            type: 'transcription',
            text: transcription.trim(),
            timestamp: Date.now()
          }));
        }
        
        return transcription;
      }

    } catch (error) {
      console.error('Error processing VAD speech segment:', error);
    } finally {
      this.isProcessing = false;
    }
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
    
    if (this.vad) {
      this.vad.destroy();
      this.vad = null;
    }
  }
}