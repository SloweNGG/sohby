/**
 * Karşı taraf yazarken mesaj listesinin altında görünen üç noktalı baloncuk
 * (karşı tarafın mesaj baloncuğuyla aynı biçim). Ekran okuyucular için
 * duyuru başlıktaki durum alanından yapılır; baloncuk gizlidir.
 */
export function TypingBubble() {
  return (
    <div className="flex justify-start" aria-hidden="true">
      <div className="flex items-center gap-1.5 rounded-[22px] bg-surface px-[18px] py-[18px]">
        {[0, 1, 2].map((i) => (
          <span key={i} className="typing-dot h-2 w-2 rounded-full bg-lilac" style={{ animationDelay: `${i * 160}ms` }} />
        ))}
      </div>
    </div>
  );
}
