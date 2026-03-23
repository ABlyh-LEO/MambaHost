document.addEventListener("DOMContentLoaded", () => {
    const serial = new window.SerialManager();
    const protocol = new window.ProtocolManager(serial);

    // UI Elements
    const elements = {
        btnConnect: document.getElementById('btnConnect'),
        connStatusDot: document.getElementById('connStatusDot'),
        connStatusText: document.getElementById('connStatusText'),
        
        btnRefreshStatus: document.getElementById('btnRefreshStatus'),
        statBatteryVolt: document.getElementById('statBatteryVolt'),
        statBatteryPct: document.getElementById('statBatteryPct'),
        statBatteryBar: document.getElementById('statBatteryBar'),
        statSysState: document.getElementById('statSysState'),
        statI2c: document.getElementById('statI2c'),
        statStorageBar: document.getElementById('statStorageBar'),
        statStorageText: document.getElementById('statStorageText'),

        btnRefreshList: document.getElementById('btnRefreshList'),
        btnDefrag: document.getElementById('btnDefrag'),
        btnFormat: document.getElementById('btnFormat'),
        trackListBody: document.getElementById('trackListBody'),

        fileInput: document.getElementById('fileInput'),
        fileDropArea: document.getElementById('fileDropArea'),
        dropMsg: document.querySelector('.drop-msg'),
        uploadTrackIdx: document.getElementById('uploadTrackIdx'),
        uploadSampleRate: document.getElementById('uploadSampleRate'),
        btnUpload: document.getElementById('btnUpload'),
        
        uploadProgressContainer: document.getElementById('uploadProgressContainer'),
        uploadProgressBar: document.getElementById('uploadProgressBar'),
        uploadStatusText: document.getElementById('uploadStatusText')
    };

    let selectedFile = null;
    let statusInterval = null;

    // --- Serial Connection ---
    elements.btnConnect.addEventListener('click', async () => {
        if (serial.isConnected) {
            await serial.disconnect();
            updateConnectionUI(false);
            clearInterval(statusInterval);
        } else {
            try {
                await serial.connect(1000000); // 1Mbps
                updateConnectionUI(true);
                
                // Fetch initial data
                protocol.queryStatus();
                protocol.queryList();
                
                // Auto refresh status every 2.5 seconds
                statusInterval = setInterval(() => protocol.queryStatus(), 2500);
            } catch (err) {
                alert("Connection failed: " + err.message);
            }
        }
    });

    serial.onDisconnect(() => {
        updateConnectionUI(false);
        clearInterval(statusInterval);
    });

    function updateConnectionUI(isConnected) {
        elements.connStatusDot.className = 'status-indicator ' + (isConnected ? 'connected' : '');
        elements.connStatusText.innerText = isConnected ? 'Connected (1M)' : 'Disconnected';
        elements.btnConnect.innerText = isConnected ? 'Disconnect' : 'Connect Serial';
        elements.btnConnect.className = isConnected ? 'btn' : 'btn primary';
    }

    // --- Status Updates ---
    elements.btnRefreshStatus.addEventListener('click', () => {
        if (serial.isConnected) protocol.queryStatus();
    });

    protocol.onStatusResponse = (status) => {
        elements.statBatteryVolt.innerText = status.batteryVoltage + " mV";
        elements.statBatteryPct.innerText = status.batteryPercent + " %";
        elements.statBatteryBar.style.width = Math.min(100, status.batteryPercent) + "%";
        
        const stateMap = ["Normal", "LowBattery", "Muted", "Transfer"];
        elements.statSysState.innerText = stateMap[status.systemState] || status.systemState;
        elements.statI2c.innerText = status.i2cAvailable ? "Ready" : "Offline";

        let totalMb = (status.flashTotal / 1024 / 1024).toFixed(2);
        let usedMb = (status.flashUsed / 1024 / 1024).toFixed(2);
        let usedPct = (status.flashUsed / status.flashTotal) * 100;
        
        elements.statStorageText.innerText = `${usedMb} MB / ${totalMb} MB`;
        elements.statStorageBar.style.width = Math.min(100, usedPct) + "%";
    };

    // --- Track Management ---
    elements.btnRefreshList.addEventListener('click', () => {
        if (serial.isConnected) protocol.queryList();
    });

    elements.btnDefrag.addEventListener('click', () => {
        if (!serial.isConnected) return;
        if (confirm("Defrag may take some time and you CANNOT power off the device. Proceed?")) {
            setGenericAction("Defragging flash...");
            protocol.defrag();
        }
    });

    elements.btnFormat.addEventListener('click', () => {
        if (!serial.isConnected) return;
        if (confirm("This will clear all audio indexes. Proceed?")) {
            setGenericAction("Formatting...");
            protocol.formatAll();
        }
    });

    protocol.onListResponse = (tracks) => {
        elements.trackListBody.innerHTML = "";
        if (tracks.length === 0) {
            elements.trackListBody.innerHTML = '<tr><td colspan="5" class="empty-msg">No tracks found.</td></tr>';
            return;
        }

        tracks.forEach(t => {
            let tr = document.createElement('tr');
            let duration = (t.length / t.sampleRate).toFixed(1);
            let sizeKb = (t.length / 1024).toFixed(1);
            
            tr.innerHTML = `
                <td>${t.index}</td>
                <td>${sizeKb} KB</td>
                <td>${t.sampleRate} Hz</td>
                <td>${duration} s</td>
                <td class="action-btns">
                    <button class="btn btn-small danger outline" data-idx="${t.index}">Delete</button>
                </td>
            `;
            elements.trackListBody.appendChild(tr);
        });

        // Add delete listeners
        document.querySelectorAll('.action-btns button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                let idx = e.target.getAttribute('data-idx');
                if (confirm(`Delete track ${idx}?`)) {
                    setGenericAction("Deleting...");
                    protocol.deleteTrack(parseInt(idx));
                }
            });
        });
    };

    function setGenericAction(msg) {
        // We reuse the progress context for generic actions
        elements.uploadProgressContainer.style.display = 'flex';
        elements.uploadStatusText.innerText = msg;
        elements.uploadProgressBar.style.width = '100%';
        protocol.onGenericAck = (err) => {
            protocol.onGenericAck = null;
            elements.uploadProgressContainer.style.display = 'none';
            if (err) alert("Action failed: " + err);
            else protocol.queryList(); // auto refresh list
        };
    }

    // --- File Upload UI ---
    elements.fileDropArea.addEventListener('click', () => elements.fileInput.click());
    
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
        elements.fileDropArea.addEventListener(evt, e => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    ['dragenter', 'dragover'].forEach(evt => {
        elements.fileDropArea.addEventListener(evt, () => elements.fileDropArea.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(evt => {
        elements.fileDropArea.addEventListener(evt, () => elements.fileDropArea.classList.remove('dragover'), false);
    });

    elements.fileDropArea.addEventListener('drop', e => {
        let dt = e.dataTransfer;
        if (dt.files && dt.files.length > 0) handleFileSelect(dt.files[0]);
    });

    elements.fileInput.addEventListener('change', e => {
        if (e.target.files.length > 0) handleFileSelect(e.target.files[0]);
    });

    function handleFileSelect(file) {
        selectedFile = file;
        elements.dropMsg.innerText = `Selected: ${file.name} (${(file.size/1024/1024).toFixed(2)} MB)`;
        elements.btnUpload.disabled = false;
    }

    // --- Upload Process ---
    elements.btnUpload.addEventListener('click', async () => {
        if (!selectedFile || !serial.isConnected) {
            alert("File not selected or Serial not connected.");
            return;
        }

        let [srStr, bitStr] = elements.uploadSampleRate.value.split('_');
        let targetSampleRate = parseInt(srStr);
        let targetBits = parseInt(bitStr);
        let trackIdx = parseInt(elements.uploadTrackIdx.value);

        elements.btnUpload.disabled = true;
        elements.fileInput.disabled = true;
        elements.uploadProgressContainer.style.display = 'flex';
        elements.uploadStatusText.innerText = "Processing Audio...";
        elements.uploadProgressBar.style.width = '5%';

        try {
            // 1. Convert Audio
            const pcmData = await window.AudioProcessor.convertToRaw(selectedFile, targetSampleRate, targetBits);
            
            // 2. Start Transfer Protocol
            await protocolUploadLoop(trackIdx, pcmData);
            
        } catch (err) {
            alert("Upload failed: " + err.message);
            elements.uploadProgressContainer.style.display = 'none';
        } finally {
            elements.btnUpload.disabled = false;
            elements.fileInput.disabled = false;
        }
    });

    function protocolUploadLoop(trackIdx, pcmData) {
        return new Promise((resolve, reject) => {
            const buffer = pcmData.buffer;
            const totalSize = buffer.length;
            const totalPackets = Math.ceil(totalSize / window.PROTOCOL.PACKET_DATA_SIZE);
            const ACK_INTERVAL = 8;
            
            let seq = 1;
            let expectedAckSeq = 0;
            
            elements.uploadStatusText.innerText = "Requesting Upload Space...";
            
            // Wait for NAK or ACK for START command
            protocol.onTransferNak = (errStr) => {
                protocol.onTransferAck = null;
                protocol.onTransferNak = null;
                reject(new Error(errStr));
            };

            protocol.onTransferAck = async (ackSeq) => {
                // If it's ACK for START_TRANSFER (seq 0)
                if (ackSeq === 0 && seq === 1) {
                    sendNextBatch();
                } 
                // Ack for batch
                else {
                    expectedAckSeq = seq - 1; 
                    if (seq > totalPackets) {
                        // All packets sent and acknowledged, END transfer
                        elements.uploadStatusText.innerText = "Finalizing upload...";
                        protocol.onTransferAck = (finalAck) => {
                            protocol.onTransferAck = null;
                            protocol.onTransferNak = null;
                            elements.uploadStatusText.innerText = "Upload Complete!";
                            elements.uploadProgressBar.style.width = '100%';
                            protocol.queryList(); // refresh list
                            protocol.queryStatus();
                            setTimeout(() => { elements.uploadProgressContainer.style.display = 'none'; }, 2000);
                            resolve();
                        };
                        await protocol.endTransfer();
                    } else {
                        // send next batch
                        sendNextBatch();
                    }
                }
            };

            async function sendNextBatch() {
                let limit = Math.min(seq + ACK_INTERVAL - 1, totalPackets);
                for (; seq <= limit; seq++) {
                    let offset = (seq - 1) * window.PROTOCOL.PACKET_DATA_SIZE;
                    let chunk = buffer.subarray(offset, Math.min(offset + window.PROTOCOL.PACKET_DATA_SIZE, totalSize));
                    await protocol.sendDataPacket(seq, chunk);
                    
                    if (seq % 10 === 0 || seq === totalPackets) {
                        let pct = Math.floor((seq / totalPackets) * 100);
                        elements.uploadProgressBar.style.width = pct + "%";
                        elements.uploadStatusText.innerText = `Uploading... ${pct}%`;
                    }
                }
            }

            // Initiate
            protocol.startTransfer(trackIdx, totalSize, pcmData.sampleRate, pcmData.bits).catch(reject);
        });
    }
});
