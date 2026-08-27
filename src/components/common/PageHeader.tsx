import { useNavigate } from 'react-router';
import Icon from '../Icon';

interface PageHeaderProps {
  title: string;
  backTo?: string;
  right?: React.ReactNode;
}

/** 子页面顶部栏：返回 + 居中标题（吸顶） */
export default function PageHeader({ title, backTo, right }: PageHeaderProps) {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-30 bg-ink/80 backdrop-blur-md border-b border-gold-dark/20 safe-top">
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => (backTo ? navigate(backTo) : navigate(-1))}
          className="text-ivory/80 active:scale-95 text-sm min-w-[48px] text-left"
        >
          <Icon e="←" size={16} className="align-middle" /> 返回
        </button>
        <h1 className="text-base font-semibold text-ivory">{title}</h1>
        <div className="min-w-[48px] flex justify-end">{right}</div>
      </div>
    </header>
  );
}
