import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ChatLayout } from './features/chat/components/ChatLayout';
import { initialize, shutdown } from './features/chat/services/runtime';
import './styles.css';

void initialize();
if (import.meta.hot) import.meta.hot.dispose(shutdown);
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><BrowserRouter><Routes>
    <Route path="/chat" element={<ChatLayout />} />
    <Route path="/chat/:conversationId" element={<ChatLayout />} />
    <Route path="*" element={<Navigate to="/chat" replace />} />
  </Routes></BrowserRouter></React.StrictMode>,
);
