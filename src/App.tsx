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
import AccountGate from './components/AccountGate'
import Login from './pages/Login'
import Register from './pages/Register'
import MigrateDialog from './components/MigrateDialog'
import GuestBanner from './components/GuestBanner'
import { useUserStore } from './store/userStore'
import { useCloudBootstrap } from './hooks/useCloudBootstrap'

export default function App() {
  const [booting, setBooting] = useState(true)
  const activeId = useUserStore((s) => s.activeId)

  // 云端账号启动引导：探测云端 + 尝试用 cookie 恢复会话（仅一次）
  useCloudBootstrap()

  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 900)
    return () => clearTimeout(t)
  }, [])

  if (booting) return <LoadingScreen />
  if (!activeId) return <AccountGate />

  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/lobby" element={<Lobby />} />
        <Route path="/game" element={<PokerTrainer />} />
        <Route path="/training" element={<TrainingHub />} />
        <Route path="/drills" element={<Drills />} />
        <Route path="/blackjack" element={<Blackjack />} />
        <Route path="/room" element={<FriendRoom />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <MigrateDialog />
      <GuestBanner />
    </>
  )
}
