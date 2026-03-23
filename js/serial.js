/**
 * SerialManager class handles the Web Serial API connection
 */
class SerialManager {
    constructor() {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.isConnected = false;
        this.onDataCallback = null;
        this.onDisconnectCallback = null;
    }

    /**
     * Set the callback for when data is received
     * @param {function(Uint8Array)} callback 
     */
    onData(callback) {
        this.onDataCallback = callback;
    }
    
    /**
     * Set the callback for unexpected disconnections
     * @param {function()} callback 
     */
    onDisconnect(callback) {
        this.onDisconnectCallback = callback;
    }

    /**
     * Request a port and open it
     * @param {number} baudRate default 1000000
     */
    async connect(baudRate = 1000000) {
        if (!('serial' in navigator)) {
            throw new Error('Web Serial API is not supported in this browser. Use Chrome or Edge.');
        }

        try {
            this.port = await navigator.serial.requestPort();
            await this.port.open({ baudRate: baudRate });
            
            this.writer = this.port.writable.getWriter();
            this.isConnected = true;
            
            // Start read loop
            this._readLoop();
            
            return true;
        } catch (error) {
            console.error('Serial connection failed:', error);
            this.port = null;
            throw error;
        }
    }

    /**
     * Close the connection
     */
    async disconnect() {
        this.isConnected = false;
        
        if (this.reader) {
            await this.reader.cancel();
            this.reader = null;
        }
        
        if (this.writer) {
            this.writer.releaseLock();
            this.writer = null;
        }
        
        if (this.port) {
            await this.port.close();
            this.port = null;
        }
    }

    /**
     * Write binary data to the serial port
     * @param {Uint8Array} data 
     */
    async write(data) {
        if (!this.isConnected || !this.writer) {
            throw new Error('Not connected to a serial port');
        }
        
        try {
            await this.writer.write(data);
        } catch (error) {
            console.error('Error writing to serial:', error);
            throw error;
        }
    }

    /**
     * Background loop to read incoming data
     */
    async _readLoop() {
        while (this.port.readable && this.isConnected) {
            this.reader = this.port.readable.getReader();
            try {
                while (true) {
                    const { value, done } = await this.reader.read();
                    if (done) break;
                    if (value && this.onDataCallback) {
                        this.onDataCallback(value);
                    }
                }
            } catch (error) {
                console.error('Read loop error:', error);
            } finally {
                if (this.reader) {
                    this.reader.releaseLock();
                    this.reader = null;
                }
            }
        }
        
        if (this.isConnected) {
            this.isConnected = false;
            if (this.onDisconnectCallback) {
                this.onDisconnectCallback();
            }
        }
    }
}

// Export for use if modules
window.SerialManager = SerialManager;
