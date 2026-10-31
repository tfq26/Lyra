import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
import harpIcon from './public/icons/harp-svgrepo-com.svg';

document.title = `Lyra v${__APP_VERSION__} — Multi-Agent Workspace`;
const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') || document.createElement('link');
favicon.rel = 'icon';
favicon.href = harpIcon;
document.head.appendChild(favicon);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
