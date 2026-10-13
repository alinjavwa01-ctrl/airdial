import { useEffect, useState, type ReactElement } from 'react';
import { useStored } from '../store/storage';
import { stopAll } from '../agent/runtime';
import { ChartIcon, GearIcon, HomeIcon, InboxIcon, PeopleIcon } from './components/icons';
import { Home } from './screens/Home';
import { TaskRun } from './screens/TaskRun';
import { Approvals } from './screens/Approvals';
import { Contacts } from './screens/Contacts';
import { Summary } from './screens/Summary';
import { SettingsScreen } from './screens/Settings';
import { Onboarding } from './screens/Onboarding';

export type Route =
  | { name: 'home' }
  | { name: 'task'; id: string }
  | { name: 'approvals' }
  | { name: 'contacts'; id?: string }
  | { name: 'summary' }
  | { name: 'settings'; section?: string };

export type Go = (r: Route) => void;

export function App() {
  const [settings, , ready] = useStored('settings');
  const [approvals] = useStored('approvals');
  const [route, setRoute] = useState<Route>({ name: 'home' });

  // Stop button on the in-page banner.
  useEffect(() => {
    const fn = (msg: { type?: string }) => {
      if (msg?.type === 'airdial-stop') stopAll();
    };
    chrome.runtime.onMessage.addListener(fn);
    return () => chrome.runtime.onMessage.removeListener(fn);
  }, []);

  if (!ready) return null;
  if (!settings.onboarded) return <Onboarding />;

  const pending = approvals.filter((a) => a.status === 'pending' || a.status === 'failed').length;
  const tabs: { name: Route['name']; label: string; icon: ReactElement; badge?: number }[] = [
    { name: 'home', label: 'Home', icon: <HomeIcon /> },
    { name: 'approvals', label: 'Approve', icon: <InboxIcon />, badge: pending },
    { name: 'contacts', label: 'Contacts', icon: <PeopleIcon /> },
    { name: 'summary', label: 'Today', icon: <ChartIcon /> },
    { name: 'settings', label: 'Settings', icon: <GearIcon /> },
  ];
  const current = route.name === 'task' ? 'home' : route.name;

  return (
    <div className="app">
      {route.name === 'home' && <Home go={setRoute} />}
      {route.name === 'task' && <TaskRun id={route.id} go={setRoute} />}
      {route.name === 'approvals' && <Approvals go={setRoute} />}
      {route.name === 'contacts' && <Contacts go={setRoute} id={route.id} />}
      {route.name === 'summary' && <Summary go={setRoute} />}
      {route.name === 'settings' && <SettingsScreen section={route.section} />}
      <nav className="nav" aria-label="Main">
        {tabs.map((t) => (
          <button key={t.name} type="button" aria-current={current === t.name ? 'page' : undefined} onClick={() => setRoute({ name: t.name } as Route)}>
            {t.icon}
            {t.label}
            {!!t.badge && <span className="badge">{t.badge}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}

export function Header(props: { title: string; left?: ReactElement; right?: ReactElement }) {
  return (
    <header className="header">
      {props.left ?? <span className="logo" aria-hidden />}
      <h1 className="grow ellipsis">{props.title}</h1>
      {props.right}
    </header>
  );
}
