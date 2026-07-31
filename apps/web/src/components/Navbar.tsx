import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';

function navPill(active: boolean): string {
  return `cursor-pointer rounded-[7px] px-3.5 py-[7px] text-[13.5px] font-semibold ${
    active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
  }`;
}

export function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState('');

  return (
    <div className="sticky top-0 z-40 flex h-[60px] items-center gap-6 border-b border-zinc-800 bg-zinc-950/75 px-5 backdrop-blur-xl">
      <div className="flex shrink-0 cursor-pointer items-center gap-2" onClick={() => navigate('/')}>
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-violet-800 text-sm font-extrabold text-white">
          柵
        </div>
        <div className="text-[15px] font-bold tracking-tight">
          Sakuya<span className="text-accent">.</span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <NavLink to="/" className={({ isActive }) => navPill(isActive)}>
          Dashboard
        </NavLink>
        <NavLink to="/board" className={({ isActive }) => navPill(isActive)}>
          Board
        </NavLink>
      </div>
      <div className="relative ml-2 max-w-[420px] flex-1">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">⌕</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const q = search.trim();
              navigate(q ? `/board?q=${encodeURIComponent(q)}` : '/board');
            }
          }}
          placeholder="Search tags, titles..."
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-2 pl-8 pr-3 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-600"
        />
      </div>
      <div className="flex-1" />
      <div
        title="Settings"
        onClick={() => navigate('/settings')}
        className={`flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-lg text-base text-zinc-400 ${
          location.pathname.startsWith('/settings') ? 'bg-zinc-800' : 'hover:bg-zinc-900'
        }`}
      >
        ⚙
      </div>
    </div>
  );
}
