// In-world handlebar device screen (canvas texture) drawing.
import { fmtTime } from './util.js';

export function drawDevice(canvas, d) {
  const c = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  c.fillStyle = '#0f1419'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#1b2530'; c.fillRect(0, 0, W, 34);
  c.font = 'bold 22px system-ui, sans-serif'; c.textBaseline = 'middle';
  c.fillStyle = '#ffd21f'; c.fillText('PUP TRACKER', 12, 18);
  c.fillStyle = '#9fe870'; c.textAlign = 'right'; c.fillText('⏱ ' + fmtTime(d.time), W - 10, 18); c.textAlign = 'left';
  // speed
  c.fillStyle = '#ffffff'; c.font = 'bold 84px system-ui, sans-serif';
  c.fillText(String(Math.round(d.speed * 3.6)).padStart(2, '0'), 12, 98);
  c.font = 'bold 20px system-ui, sans-serif'; c.fillStyle = '#8fa3b5'; c.fillText('km/h', 16, 150);
  // speed bar
  c.fillStyle = '#26323d'; c.fillRect(12, 168, 150, 12);
  c.fillStyle = d.drift ? '#ff7a1a' : '#ffd21f'; c.fillRect(12, 168, Math.min(150, d.speed / 16.5 * 150), 12);
  // dog distance + arrow
  const cx = 248, cy = 92;
  c.strokeStyle = '#2d3b48'; c.lineWidth = 4; c.beginPath(); c.arc(cx, cy, 44, 0, Math.PI * 2); c.stroke();
  c.save(); c.translate(cx, cy); c.rotate(d.rel);
  c.fillStyle = d.dist < 6 ? '#9fe870' : '#ffd21f';
  c.beginPath(); c.moveTo(0, -38); c.lineTo(15, -8); c.lineTo(5, -10); c.lineTo(5, 14); c.lineTo(-5, 14); c.lineTo(-5, -10); c.lineTo(-15, -8); c.closePath(); c.fill();
  c.restore();
  c.fillStyle = '#ffffff'; c.font = 'bold 30px system-ui, sans-serif'; c.textAlign = 'center';
  c.fillText(Math.round(d.dist) + ' m', cx, 166); c.textAlign = 'left';
  c.font = 'bold 15px system-ui, sans-serif'; c.fillStyle = '#8fa3b5'; c.textAlign = 'center';
  c.fillText(d.status, cx, 186); c.textAlign = 'left';
}
