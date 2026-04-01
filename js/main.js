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
        btnStopAudio: document.getElementById('btnStopAudio'),
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
        uploadStatusText: document.getElementById('uploadStatusText'),

        btnBattDetails: document.getElementById('btnBattDetails'),
        battModal: document.getElementById('battModal'),
        closeBattModal: document.getElementById('closeBattModal'),
        
        detCap: document.getElementById('detCap'),
        detCycles: document.getElementById('detCycles'),
        detDate: document.getElementById('detDate'),
        detLife: document.getElementById('detLife'),
        detVolt: document.getElementById('detVolt'),
        detCurr: document.getElementById('detCurr'),
        detTemp: document.getElementById('detTemp'),
        detPct: document.getElementById('detPct'),
        detState: document.getElementById('detState'),
        detErrors: document.getElementById('detErrors')
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
                
                // Fetch initial data (序列化发送, 避免背靠背导致 MCU UART 溢出)
                await protocol.queryStatus();
                await new Promise(r => setTimeout(r, 200));
                await protocol.queryList();
                
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
        
        const stateMap = ["Normal", "LowBattery", "Muted", "Transfer", "SerialAudio"];
        elements.statSysState.innerText = stateMap[status.systemState] || status.systemState;
        elements.statI2c.innerText = status.i2cAvailable ? "Ready" : "Offline";

        let totalMb = (status.flashTotal / 1024 / 1024).toFixed(2);
        let usedMb = (status.flashUsed / 1024 / 1024).toFixed(2);
        let usedPct = (status.flashUsed / status.flashTotal) * 100;
        
        elements.statStorageText.innerText = `${usedMb} MB / ${totalMb} MB`;
        elements.statStorageBar.style.width = Math.min(100, usedPct) + "%";
    };

    // --- Battery Details Modal ---
    elements.btnBattDetails.addEventListener('click', () => {
        if (!serial.isConnected) return;
        
        // Show loading or just wait
        protocol.onGenericAck = (err) => {
            protocol.onGenericAck = null;
            if (err) alert("Battery details: " + err);
        };
        protocol.queryBattInfo();
    });

    elements.closeBattModal.addEventListener('click', () => {
        elements.battModal.style.display = 'none';
    });

    // Close on click outside
    window.addEventListener('click', (e) => {
        if (e.target === elements.battModal) elements.battModal.style.display = 'none';
    });

    protocol.onBattInfoResponse = (info) => {
        elements.battModal.style.display = 'flex';
        
        elements.detCap.innerText = info.designedCapacity + " mAh";
        elements.detCycles.innerText = info.loopTimes;
        
        // Parse date (bit[15:9]+1980, bit[8:5], bit[4:0])
        const year = ((info.productionDateRaw >> 9) & 0x7F) + 1980;
        const month = (info.productionDateRaw >> 5) & 0x0F;
        const day = info.productionDateRaw & 0x1F;
        elements.detDate.innerText = `${year}-${month}-${day}`;
        
        elements.detLife.innerText = info.batteryLife + " %";
        elements.detVolt.innerText = info.voltageMv + " mV";
        elements.detCurr.innerText = info.currentMa + " mA";
        elements.detTemp.innerText = (info.temperature / 10).toFixed(1) + " °C";
        elements.detPct.innerText = info.capacityPercent + " %";

        // Internal State (bit[1]=conn, bit[0]=high_curr)
        const conn = (info.internalState >> 1) & 0x01;
        const highCurr = info.internalState & 0x01;
        elements.detState.innerText = `${conn ? "Battery Linked" : "Battery Error"} | ${highCurr ? "High Current" : "Low Current"}`;

        // Error State
        const errorBits = [
            { bit: 0, msg: "Short Circuit" },
            { bit: 1, msg: "Overload" },
            { bit: 2, msg: "Over Current" },
            { bit: 3, msg: "Over Temp" },
            { bit: 4, msg: "Under Volt" },
            { bit: 5, msg: "Cell Error" },
            { bit: 6, msg: "Self-Check Fail" }
        ];
        let errors = errorBits.filter(eb => (info.errorState >> eb.bit) & 0x01).map(eb => eb.msg);
        elements.detErrors.innerText = errors.length > 0 ? errors.join(", ") : "None";
    };

    // --- Track Management ---
    elements.btnRefreshList.addEventListener('click', () => {
        if (serial.isConnected) protocol.queryList();
    });

    elements.btnStopAudio.addEventListener('click', () => {
        if (!serial.isConnected) return;
        protocol.controlAudio(0, 0); // 0 = Stop action
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
                    <button class="btn btn-small primary outline btn-play-audio" data-idx="${t.index}">Play</button>
                    <button class="btn btn-small danger outline btn-delete-track" data-idx="${t.index}">Delete</button>
                </td>
            `;
            elements.trackListBody.appendChild(tr);
        });

        // Add delete listeners
        document.querySelectorAll('.btn-delete-track').forEach(btn => {
            btn.addEventListener('click', (e) => {
                let idx = e.target.getAttribute('data-idx');
                if (confirm(`Delete track ${idx}?`)) {
                    setGenericAction("Deleting...");
                    protocol.deleteTrack(parseInt(idx));
                }
            });
        });

        // Add play listeners
        document.querySelectorAll('.btn-play-audio').forEach(btn => {
            btn.addEventListener('click', (e) => {
                let idx = e.target.getAttribute('data-idx');
                if (serial.isConnected) protocol.controlAudio(1, parseInt(idx)); // 1 = Play action
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

        // 立即停止状态轮询！必须在音频转换之前停止，
        // 否则转换完成后发送 START_TRANSFER 可能与最后一次 queryStatus 包冲突
        // （MCU 的 DMA 在处理完第一个包后停止，第二个包会丢失）
        if (statusInterval) {
            clearInterval(statusInterval);
            statusInterval = null;
        }

        try {
            // 1. Convert Audio
            const pcmData = await window.AudioProcessor.convertToRaw(selectedFile, targetSampleRate, targetBits);
            
            // 2. 等待 200ms 确保 MCU 已处理完所有挂起的包并重新激活 DMA
            await new Promise(r => setTimeout(r, 200));

            // 3. Start Transfer Protocol
            await protocolUploadLoop(trackIdx, pcmData);
            
        } catch (err) {
            alert("Upload failed: " + err.message);
            elements.uploadProgressContainer.style.display = 'none';
        } finally {
            elements.btnUpload.disabled = false;
            elements.fileInput.disabled = false;
            // 恢复状态轮询（如果上传期间未恢复的话）
            if (!statusInterval && serial.isConnected) {
                statusInterval = setInterval(() => protocol.queryStatus(), 2500);
            }
        }
    });

    function protocolUploadLoop(trackIdx, pcmData) {
        return new Promise((resolve, reject) => {
            const buffer = pcmData.buffer;
            const totalSize = buffer.length;
            const totalPackets = Math.ceil(totalSize / window.PROTOCOL.PACKET_DATA_SIZE);
            const ACK_INTERVAL = 1; // Sync with MCU: wait for ACK after every packet
            
            let seq = 1;
            let expectedAckSeq = 0;
            let startAckTimeout = null;
            
            elements.uploadStatusText.innerText = "Requesting Upload Space...";
            
            function cleanup() {
                protocol.onTransferAck = null;
                protocol.onTransferNak = null;
                if (startAckTimeout) { clearTimeout(startAckTimeout); startAckTimeout = null; }
                // 恢复状态轮询
                if (serial.isConnected) {
                    statusInterval = setInterval(() => protocol.queryStatus(), 2500);
                }
            }

            // Wait for NAK or ACK for START command
            protocol.onTransferNak = (errStr) => {
                cleanup();
                reject(new Error(errStr));
            };

            // 30秒超时（Flash擦除大文件可能需要较长时间）
            startAckTimeout = setTimeout(() => {
                cleanup();
                reject(new Error("Timeout waiting for device response (30s). Device may be busy erasing flash."));
            }, 30000);

            protocol.onTransferAck = async (ackSeq) => {
                // If it's ACK for START_TRANSFER (seq 0)
                if (ackSeq === 0 && seq === 1) {
                    if (startAckTimeout) { clearTimeout(startAckTimeout); startAckTimeout = null; }
                    sendNextBatch();
                } 
                // Ack for batch
                else {
                    expectedAckSeq = seq - 1; 
                    if (seq > totalPackets) {
                        // All packets sent and acknowledged, END transfer
                        elements.uploadStatusText.innerText = "Finalizing upload...";
                        protocol.onTransferAck = (finalAck) => {
                            if (startAckTimeout) { clearTimeout(startAckTimeout); startAckTimeout = null; }
                            cleanup();
                            elements.uploadStatusText.innerText = "Upload Complete!";
                            elements.uploadProgressBar.style.width = '100%';
                            protocol.queryList(); // refresh list
                            protocol.queryStatus();
                            setTimeout(() => { elements.uploadProgressContainer.style.display = 'none'; }, 2000);
                            resolve();
                        };
                        
                        // Restart timeout for END_TRANSFER ACK
                        if (startAckTimeout) clearTimeout(startAckTimeout);
                        startAckTimeout = setTimeout(() => {
                            cleanup();
                            reject(new Error("Timeout waiting for final ACK."));
                        }, 5000);
                        
                        await protocol.endTransfer();
                    } else {
                        // send next batch
                        sendNextBatch();
                    }
                }
            };

            async function sendNextBatch() {
                // Reset timeout for the next batch ACK
                if (startAckTimeout) clearTimeout(startAckTimeout);
                startAckTimeout = setTimeout(() => {
                    cleanup();
                    reject(new Error(`Timeout waiting for ACK after packet ${seq-1}.`));
                }, 5000);

                let limit = Math.min(seq + ACK_INTERVAL - 1, totalPackets);
                for (; seq <= limit; seq++) {
                    let offset = (seq - 1) * window.PROTOCOL.PACKET_DATA_SIZE;
                    let chunk = buffer.subarray(offset, Math.min(offset + window.PROTOCOL.PACKET_DATA_SIZE, totalSize));
                    await protocol.sendDataPacket(seq, chunk);
                    
                    let pct = Math.floor((seq / totalPackets) * 100);
                    elements.uploadProgressBar.style.width = pct + "%";
                    elements.uploadStatusText.innerText = `Uploading... ${pct}%`;
                }
            }

            // Initiate
            protocol.startTransfer(trackIdx, totalSize, pcmData.sampleRate, pcmData.bits).catch(err => {
                cleanup();
                reject(err);
            });
        });
    }
});
