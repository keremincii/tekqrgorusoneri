/**
 * 404 — Sayfa bulunamadı.
 *
 * Hem çıplak kök adres (kasıtlı 404, bkz. app/page.js) hem de geçersiz/pasif
 * QR yönlendirmeleri burada karşılanır. Vatandaşı sistemin doğru kullanımına
 * yönlendiren sade bir mesaj gösterir; hiçbir hassas bilgi sızdırmaz.
 */
export default function NotFound() {
  return (
    <div className="page-container">
      <div className="card" style={{ maxWidth: 460, textAlign: 'center' }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🔒</div>
        <h1 className="gradient-text" style={{ fontSize: 28, marginBottom: 12 }}>
          Sayfa bulunamadı
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.6 }}>
          Şikayet göndermek için sokağınızdaki <strong>QR kodu</strong> telefonunuzla
          okutmanız gerekir. Bu adres doğrudan erişime kapalıdır.
        </p>
      </div>
    </div>
  );
}
