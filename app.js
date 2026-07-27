/* Estilos para a lista de pedidos */
.order-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.order-header {
  display: flex;
  justify-content: space-between;
  font-family: 'Space Mono', monospace;
  font-size: 12px;
  color: var(--muted);
}

.order-status {
  align-self: flex-start;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.order-items {
  font-size: 14px;
  color: var(--text);
  margin-top: 4px;
}

.order-total {
  text-align: right;
  font-family: 'Bebas Neue', sans-serif;
  font-size: 20px;
  color: var(--accent);
  margin-top: 8px;
  border-top: 1px dashed var(--border);
  padding-top: 8px;
}
