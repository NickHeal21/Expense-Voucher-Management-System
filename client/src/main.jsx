import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

function App() {
  return (
    <main className="page">
      <section className="welcome-card" aria-labelledby="page-title">
        <p className="eyebrow">Prachay Securities Private Limited</p>
        <h1 id="page-title">Expense Voucher Management System</h1>
        <p className="description">
          A simple place to prepare, review, and track employee expense vouchers.
        </p>
        <p className="status">Application starter is ready.</p>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
