export function updateHUD(speed: number, dayTime: number): void {
  const kmh = Math.round(speed * 500);
  const speedEl = document.getElementById('speedDisplay');
  if (speedEl) speedEl.textContent = `${kmh} km/h`;

  const hours = Math.floor(dayTime * 24);
  const mins = Math.floor((dayTime * 24 - hours) * 60);
  const timeEl = document.getElementById('timeDisplay');
  if (timeEl) {
    timeEl.textContent = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }
}
