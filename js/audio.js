/**
 * AudioProcessor handles decoding and converting audio files
 * to RAW PCM format for the lower computer.
 */
class AudioProcessor {
    
    /**
     * Parse and convert audio file to ArrayBuffer
     * @param {File} file The original audio file (mp3, wav, etc.)
     * @param {number} targetSampleRate e.g. 32000 or 16000
     * @param {number} targetBits 8 or 16
     * @returns {Promise<{buffer: Uint8Array, sampleRate: number, bits: number, duration: number}>}
     */
    static async convertToRaw(file, targetSampleRate = 32000, targetBits = 8) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            
            // 1. Decode original audio
            // We use standard AudioContext to decode
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            
            // 2. Resample to target sample rate using OfflineAudioContext
            const duration = decodedBuffer.duration;
            const offlineCtx = new OfflineAudioContext(
                1, // Forced Mono
                Math.ceil(duration * targetSampleRate),
                targetSampleRate
            );
            
            const source = offlineCtx.createBufferSource();
            source.buffer = decodedBuffer;
            source.connect(offlineCtx.destination);
            source.start(0);
            
            const resampledBuffer = await offlineCtx.startRendering();
            const rawFloat32 = resampledBuffer.getChannelData(0); // value from -1.0 to 1.0
            
            // 3. Convert Float32 to selected integer bit depth
            const outBuffer = new Uint8Array(
                targetBits === 16 ? rawFloat32.length * 2 : rawFloat32.length
            );
            
            let dataView = new DataView(outBuffer.buffer);
            
            for (let i = 0; i < rawFloat32.length; i++) {
                // Hard clipping
                let s = Math.max(-1, Math.min(1, rawFloat32[i]));
                
                if (targetBits === 16) {
                    // Int16 (Little Endian)
                    let int16 = s < 0 ? s * 0x8000 : s * 0x7FFF;
                    dataView.setInt16(i * 2, int16, true);
                } else {
                    // UInt8 (0-255, centered at 128)
                    let int8 = Math.round((s + 1) * 127.5);
                    dataView.setUint8(i, int8);
                }
            }
            
            return {
                buffer: outBuffer,
                sampleRate: targetSampleRate,
                bits: targetBits,
                duration: duration
            };
            
        } catch (error) {
            console.error("Audio Processing Error: ", error);
            throw new Error("Failed to process audio file: " + error.message);
        }
    }
}

window.AudioProcessor = AudioProcessor;
