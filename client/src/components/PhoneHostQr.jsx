import { QRCodeSVG } from 'qrcode.react';

// QR that opens the host view on a phone. It carries the quiz admin token,
// so it is only ever shown on the host's own screen, never on the TV.
export default function PhoneHostQr({ sessionId, adminToken, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="flex flex-col items-center gap-3 p-6 bg-white rounded-xl max-w-sm" onClick={(e) => e.stopPropagation()}>
        <QRCodeSVG value={`${window.location.origin}/host/${sessionId}?token=${adminToken}`} size={240} />
        <p className="text-gray-800 font-semibold text-center">Scan with your phone to control this session</p>
        <p className="text-gray-500 text-sm text-center">Gives admin access to the quiz — don't show it to guests.</p>
        <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-800 text-white font-semibold">Hide</button>
      </div>
    </div>
  );
}
