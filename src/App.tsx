import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router'
import Home from './pages/Home'
import Lobby from './pages/Lobby'
import PokerTrainer from './pages/PokerTrainer'
import TrainingHub from './pages/TrainingHub'
import Drills from './pages/Drills'
import Blackjack from './pages/Blackjack'
import FriendRoom from './pages/FriendRoom'
import Profile from './pages/Profile'
import LoadingScreen from './components/common/LoadingScreen'

export default function App() {
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 900)
    return () => clearTimeout(t)
  }, [])

  if (booting) return <LoadingScreen />

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/lobby" element={<Lobby />} />
      <Route path="/game" element={<PokerTrainer />} />
      <Route path="/training" element={<TrainingHub />} />
      <Route path="/drills" element={<Drills />} />
      <Route path="/blackjack" element={<Blackjack />} />
      <Route path="/room" element={<FriendRoom />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
