import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState, AppDispatch } from '../../store';
import { setSwitchBtWsUrl, setGatewayUrl } from '../../store/appSlice';
import { saveSettings } from '../../db/settings';
import ControllerList from './ControllerList';

export default function SettingsPanel() {
    const dispatch = useDispatch<AppDispatch>();
    const wsUrl = useSelector((s: RootState) => s.app.switchBtWsUrl);
    const gatewayUrl = useSelector((s: RootState) => s.app.gatewayUrl);

    const [wsInput, setWsInput] = useState(wsUrl);
    const [gatewayInput, setGatewayInput] = useState(gatewayUrl);
    const [saved, setSaved] = useState(false);

    useEffect(() => { setWsInput(wsUrl); }, [wsUrl]);
    useEffect(() => { setGatewayInput(gatewayUrl); }, [gatewayUrl]);

    const handleSave = async () => {
        dispatch(setSwitchBtWsUrl(wsInput));
        dispatch(setGatewayUrl(gatewayInput));
        await saveSettings({ switchBtWsUrl: wsInput });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    return (
        <div className="panel settings-panel">
            <h2>設定</h2>

            <section>
                <h3>switch-bt-ws 接続先</h3>
                <div className="form-group">
                    <label>WebSocket URL</label>
                    <input
                        type="text"
                        value={wsInput}
                        onChange={e => setWsInput(e.target.value)}
                        placeholder="ws://localhost:8765"
                    />
                    <p className="hint">ローカルの switch-bt-ws サーバーのアドレスを指定します。</p>
                </div>

                <h3>バンドルゲートウェイ</h3>
                <div className="form-group">
                    <label>Cloudflare Worker URL</label>
                    <input
                        type="text"
                        value={gatewayInput}
                        onChange={e => setGatewayInput(e.target.value)}
                        placeholder="https://video-html-gateway.your-account.workers.dev"
                    />
                    <p className="hint">WebPush シグナリングに使用するサーバーです。</p>
                </div>

                <button className="btn btn-primary" onClick={handleSave}>
                    {saved ? '✓ 保存しました' : '保存'}
                </button>
            </section>

            <section>
                <h3>switch-bt-ws コントローラー管理</h3>
                <ControllerList />
            </section>
        </div>
    );
}
