/**
 * video-html v2 — エントリーポイント
 *
 * サービスワーカーを登録し、React アプリを起動する。
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from './store';
import App from './components/App';
import 'normalize.css';
import './style.css';

// サービスワーカー登録 (自分自身のスクリプトをSWとして登録)
if ('serviceWorker' in navigator) {
    const swUrl = new URL('/sw.js', window.location.origin).href;
    navigator.serviceWorker.register(swUrl).catch(err => {
        console.error('Service worker registration failed:', err);
    });
}

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
    <React.StrictMode>
        <Provider store={store}>
            <App />
        </Provider>
    </React.StrictMode>,
);
