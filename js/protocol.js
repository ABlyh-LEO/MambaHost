const PROTOCOL = {
    HEADER_0: 0xAA,
    HEADER_1: 0x55,
    PACKET_DATA_SIZE: 128,
    PACKET_TOTAL_SIZE: 136,
    
    CMD_START_TRANSFER: 0x01,
    CMD_DATA_PACKET: 0x02,
    CMD_END_TRANSFER: 0x03,
    
    CMD_ACK: 0x10,
    CMD_NAK: 0x11,
    
    CMD_QUERY_LIST: 0x20,
    CMD_LIST_RESPONSE: 0x21,
    CMD_DELETE_TRACK: 0x30,
    CMD_FORMAT_ALL: 0x31,
    CMD_QUERY_STATUS: 0x32,
    CMD_STATUS_RESPONSE: 0x33,
    CMD_DEFRAG: 0x34
};

const ERROR_CODE = {
    0: "SEQ_MISMATCH",
    1: "TRACK_NOT_FOUND",
    2: "NO_SPACE",
    3: "BAD_PARAM",
    4: "OP_FAILED"
};

/**
 * ProtocolManager wraps SerialManager and adds packet formatting and CRC.
 */
class ProtocolManager {
    /**
     * @param {SerialManager} serialManager 
     */
    constructor(serialManager) {
        this.serial = serialManager;
        this.rxBuffer = new Uint8Array(1024);
        this.rxLength = 0;
        
        // Event Listeners set from higher up
        this.onListResponse = null;
        this.onStatusResponse = null;
        this.onTransferAck = null;
        this.onTransferNak = null;
        this.onGenericAck = null;

        // Pipe serial data to protocol parser
        this.serial.onData((data) => this._pushData(data));
    }

    _pushData(data) {
        // Simple buffer appending (assuming traffic isn't overwhelming max size at once)
        if (this.rxLength + data.length > this.rxBuffer.length) {
            // Expand buffer if needed
            let newBuffer = new Uint8Array(this.rxBuffer.length * 2);
            newBuffer.set(this.rxBuffer.subarray(0, this.rxLength));
            this.rxBuffer = newBuffer;
        }
        
        this.rxBuffer.set(data, this.rxLength);
        this.rxLength += data.length;
        
        this._parseBuffer();
    }

    _parseBuffer() {
        while (this.rxLength >= PROTOCOL.PACKET_TOTAL_SIZE) {
            // Find Header
            let headerIdx = -1;
            for (let i = 0; i <= this.rxLength - 2; i++) {
                if (this.rxBuffer[i] === PROTOCOL.HEADER_0 && 
                    this.rxBuffer[i+1] === PROTOCOL.HEADER_1) {
                    headerIdx = i;
                    break;
                }
            }

            if (headerIdx === -1) {
                // No header found, clear buffer
                this.rxLength = 0;
                break;
            }

            if (headerIdx > 0) {
                // Shift buffer to align header at 0
                this.rxBuffer.copyWithin(0, headerIdx, this.rxLength);
                this.rxLength -= headerIdx;
            }

            if (this.rxLength >= PROTOCOL.PACKET_TOTAL_SIZE) {
                // We have a full packet
                let packetBytes = this.rxBuffer.subarray(0, PROTOCOL.PACKET_TOTAL_SIZE);
                let isValid = this._checkCRC(packetBytes);
                
                if (isValid) {
                    this._handlePacket(packetBytes);
                } else {
                    console.warn("CRC Failed, ignoring packet.");
                }

                // Shift buffer to remove processed packet
                this.rxBuffer.copyWithin(0, PROTOCOL.PACKET_TOTAL_SIZE, this.rxLength);
                this.rxLength -= PROTOCOL.PACKET_TOTAL_SIZE;
            }
        }
    }

    _checkCRC(packetBytes) {
        let dv = new DataView(packetBytes.buffer, packetBytes.byteOffset, packetBytes.byteLength);
        let expectedCrc = dv.getUint16(PROTOCOL.PACKET_TOTAL_SIZE - 2, true); // Little endian
        let calculatedCrc = ProtocolManager.crc16Ccitt(packetBytes.subarray(2, PROTOCOL.PACKET_TOTAL_SIZE - 2));
        return expectedCrc === calculatedCrc;
    }

    _handlePacket(packetBytes) {
        let dv = new DataView(packetBytes.buffer, packetBytes.byteOffset, packetBytes.byteLength);
        let cmd = dv.getUint8(2);
        let seq = dv.getUint16(3, true);
        let len = dv.getUint8(5);
        let data = new Uint8Array(packetBytes.buffer, packetBytes.byteOffset + 6, len);

        switch(cmd) {
            case PROTOCOL.CMD_ACK:
                let ackSeq = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(0, true);
                if (this.onTransferAck) this.onTransferAck(ackSeq);
                if (this.onGenericAck) this.onGenericAck();
                break;
            case PROTOCOL.CMD_NAK:
                let errCode = data[0];
                let errDetail = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(1, true);
                let errStr = ERROR_CODE[errCode] || `UNKNOWN(${errCode})`;
                if (this.onTransferNak) this.onTransferNak(errStr, errDetail);
                if (this.onGenericAck) this.onGenericAck(errStr); // Pass error to generic handler too
                break;
            case PROTOCOL.CMD_LIST_RESPONSE:
                this._parseListResponse(data);
                break;
            case PROTOCOL.CMD_STATUS_RESPONSE:
                this._parseStatusResponse(data);
                break;
            default:
                console.log("Unknown packet cmd:", cmd);
        }
    }

    _parseListResponse(data) {
        if (!this.onListResponse) return;
        let count = data[0];
        let tracks = [];
        let pos = 1;
        let dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
        
        for (let i = 0; i < count; i++) {
            if (pos + 7 > data.length) break;
            let idx = data[pos++];
            let length = dv.getUint32(pos, true); pos += 4;
            let sampleRate = dv.getUint16(pos, true); pos += 2;
            tracks.push({ index: idx, length: length, sampleRate: sampleRate });
        }
        
        this.onListResponse(tracks);
    }

    _parseStatusResponse(data) {
        if (!this.onStatusResponse) return;
        let dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
        let pos = 0;
        
        let batteryVoltage = dv.getUint32(pos, true); pos += 4;
        let batteryPercent = dv.getUint8(pos++);
        let i2cAvailable = dv.getUint8(pos++);
        let systemState = dv.getUint8(pos++);
        let flashUsed = dv.getUint32(pos, true); pos += 4;
        let flashTotal = dv.getUint32(pos, true); pos += 4;
        let trackCount = dv.getUint8(pos++);
        
        this.onStatusResponse({
            batteryVoltage, batteryPercent, i2cAvailable, systemState, 
            flashUsed, flashTotal, trackCount
        });
    }

    /**
     * Send generic command (no data or simple payload)
     */
    async sendCommand(cmd, dataBuf = null, seq = 0) {
        let pkt = new Uint8Array(PROTOCOL.PACKET_TOTAL_SIZE);
        pkt.fill(0);
        
        let dv = new DataView(pkt.buffer);
        dv.setUint8(0, PROTOCOL.HEADER_0);
        dv.setUint8(1, PROTOCOL.HEADER_1);
        dv.setUint8(2, cmd);
        dv.setUint16(3, seq, true); // Little endian
        
        let dataLen = 0;
        if (dataBuf) {
            dataLen = Math.min(dataBuf.length, PROTOCOL.PACKET_DATA_SIZE);
            pkt.set(dataBuf.subarray(0, dataLen), 6);
        }
        dv.setUint8(5, dataLen);
        
        let crc = ProtocolManager.crc16Ccitt(pkt.subarray(2, PROTOCOL.PACKET_TOTAL_SIZE - 2));
        dv.setUint16(PROTOCOL.PACKET_TOTAL_SIZE - 2, crc, true);
        
        await this.serial.write(pkt);
    }

    async queryList() { await this.sendCommand(PROTOCOL.CMD_QUERY_LIST); }
    async queryStatus() { await this.sendCommand(PROTOCOL.CMD_QUERY_STATUS); }
    async deleteTrack(idx) { await this.sendCommand(PROTOCOL.CMD_DELETE_TRACK, new Uint8Array([idx])); }
    async defrag() { await this.sendCommand(PROTOCOL.CMD_DEFRAG); }
    async formatAll() { await this.sendCommand(PROTOCOL.CMD_FORMAT_ALL); }

    // Upload Data Helpers
    async startTransfer(trackIdx, totalSize, sampleRate, bits) {
        let data = new Uint8Array(8);
        let dv = new DataView(data.buffer);
        dv.setUint8(0, trackIdx);
        dv.setUint32(1, totalSize, true);
        dv.setUint16(5, sampleRate, true);
        dv.setUint8(7, bits);
        await this.sendCommand(PROTOCOL.CMD_START_TRANSFER, data);
    }
    
    async sendDataPacket(seq, rawChunk) {
        await this.sendCommand(PROTOCOL.CMD_DATA_PACKET, rawChunk, seq);
    }

    async endTransfer() {
        await this.sendCommand(PROTOCOL.CMD_END_TRANSFER);
    }

    /**
     * Calculate CRC-CCITT-FALSE
     */
    static crc16Ccitt(data) {
        let crc = 0xFFFF;
        for (let i = 0; i < data.length; i++) {
            crc ^= (data[i] << 8);
            for (let j = 0; j < 8; j++) {
                if (crc & 0x8000) {
                    crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
                } else {
                    crc = (crc << 1) & 0xFFFF;
                }
            }
        }
        return crc & 0xFFFF;
    }
}

window.ProtocolManager = ProtocolManager;window.PROTOCOL = PROTOCOL;
