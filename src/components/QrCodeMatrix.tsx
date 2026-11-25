import { useT } from '../i18n/useLang';
import QRCode from 'qrcode';

export function QrCodeMatrix({ value, size = 136 }: { value: string; size?: number }) {
  const { t } = useT();
  const { modules } = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const cells: string[] = [];
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (modules.get(row, col)) cells.push(`M${col + 4},${row + 4}h1v1h-1z`);
    }
  }
  return (
    <svg role="img" aria-label={t('qr.phone.aria')} width={size} height={size}
      viewBox={`0 0 ${modules.size + 8} ${modules.size + 8}`} shapeRendering="crispEdges">
      <rect width="100%" height="100%" fill="#fff" />
      <path d={cells.join('')} fill="#000" />
    </svg>
  );
}
