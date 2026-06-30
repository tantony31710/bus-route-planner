import React, { useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'motion/react';
import { Users, CheckCircle, XCircle, Clock } from 'lucide-react';

// ── Animated count-up number ─────────────────────────────────────────────────
function AnimatedNumber({ value, className = '' }: { value: number; className?: string }) {
  const reduced = useReducedMotion();
  const mv = useMotionValue(reduced ? value : 0);
  const spring = useSpring(mv, { stiffness: 55, damping: 16 });
  const display = useTransform(spring, (v) => Math.round(v).toString());

  useEffect(() => {
    mv.set(value);
  }, [value, mv]);

  return <motion.span className={className}>{display}</motion.span>;
}

// ── Stat card ────────────────────────────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  accentClass: string;         // Tailwind text colour class
  bgClass: string;             // Tailwind bg colour class
  borderClass: string;         // Tailwind border colour class
  delay: number;
}

function StatCard({ label, value, icon, accentClass, bgClass, borderClass, delay }: StatCardProps) {
  const reduced = useReducedMotion() ?? false;

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: 'easeOut', delay: reduced ? 0 : delay }}
      className={`flex items-center gap-4 px-5 py-4 rounded-2xl border ${bgClass} ${borderClass} shadow-lg flex-1 min-w-[140px]`}
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${bgClass} border ${borderClass}`}>
        <span className={accentClass}>{icon}</span>
      </div>

      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#8E9299] leading-none mb-1">
          {label}
        </p>
        <p className={`text-2xl font-extrabold font-mono leading-none ${accentClass}`}>
          <AnimatedNumber value={value} />
        </p>
      </div>
    </motion.div>
  );
}

// ── Props ────────────────────────────────────────────────────────────────────
export interface AnimatedStatsBarProps {
  total: number;
  boarded: number;
  absent: number;
  notBoarded: number;
}

// ── Main component ───────────────────────────────────────────────────────────
export default function AnimatedStatsBar({
  total,
  boarded,
  absent,
  notBoarded,
}: AnimatedStatsBarProps) {
  const stats: Omit<StatCardProps, 'delay'>[] = [
    {
      label: 'Total Students',
      value: total,
      icon: <Users className="w-5 h-5" />,
      accentClass: 'text-[#3B82F6]',
      bgClass: 'bg-[#3B82F6]/5',
      borderClass: 'border-[#3B82F6]/20',
    },
    {
      label: 'Boarded',
      value: boarded,
      icon: <CheckCircle className="w-5 h-5" />,
      accentClass: 'text-[#10B981]',
      bgClass: 'bg-[#10B981]/5',
      borderClass: 'border-[#10B981]/20',
    },
    {
      label: 'Not Boarded',
      value: notBoarded,
      icon: <Clock className="w-5 h-5" />,
      accentClass: 'text-[#F59E0B]',
      bgClass: 'bg-[#F59E0B]/5',
      borderClass: 'border-[#F59E0B]/20',
    },
    {
      label: 'Absent',
      value: absent,
      icon: <XCircle className="w-5 h-5" />,
      accentClass: 'text-[#EF4444]',
      bgClass: 'bg-[#EF4444]/5',
      borderClass: 'border-[#EF4444]/20',
    },
  ];

  return (
    <div
      className="flex flex-wrap gap-3 w-full"
      role="region"
      aria-label="Attendance Statistics"
    >
      {stats.map((stat, i) => (
        <StatCard key={stat.label} {...stat} delay={i * 0.08} />
      ))}
    </div>
  );
}
