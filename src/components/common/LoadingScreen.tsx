export default function LoadingScreen() {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-ink z-[100]">
      <div className="relative">
        <div className="text-6xl mb-4 animate-pulse-slow">♠</div>
        <div className="absolute -top-2 -right-2 text-3xl text-gold">♥</div>
        <div className="absolute -bottom-2 -left-2 text-3xl text-gold">♦</div>
      </div>
      <div className="text-gold font-bold text-xl mt-4">PokerMind</div>
      <div className="text-ivory/50 text-sm mt-2">正在准备你的牌桌…</div>
    </div>
  );
}
