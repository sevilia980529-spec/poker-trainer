import { Routes, Route } from 'react-router'
import PokerTrainer from './pages/PokerTrainer'
import Drills from './pages/Drills'
import Blackjack from './pages/Blackjack'
import FriendRoom from './pages/FriendRoom'
import Guandan from './pages/Guandan'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<PokerTrainer />} />
      <Route path="/drills" element={<Drills />} />
      <Route path="/blackjack" element={<Blackjack />} />
      <Route path="/room" element={<FriendRoom />} />
      <Route path="/guandan" element={<Guandan />} />
    </Routes>
  )
}
