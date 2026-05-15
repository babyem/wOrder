import { motion } from 'framer-motion'

export default function Spinner({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <motion.div
      className={`border-2 border-slate-200 border-t-indigo-500 rounded-full ${className}`}
      style={{ width: size, height: size }}
      animate={{ rotate: 360 }}
      transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
    />
  )
}
