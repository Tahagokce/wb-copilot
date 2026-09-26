import { ArrowUpRight, ClipboardList, Plane, Scale, Users } from 'lucide-react';
import { Brand } from './Brand';
const suggestions = [
  { icon: Plane, title: 'Flight information', text: 'Find flight details', prompt: 'Get flight details for TK1853.' },
  { icon: ClipboardList, title: 'Loadsheet analysis', text: 'Review a loadsheet', prompt: 'Help me review a loadsheet. What information do you need?' },
  { icon: Users, title: 'Passenger information', text: 'Explore passenger data', prompt: 'Help me review passenger information for a flight.' },
  { icon: Scale, title: 'Weight & balance', text: 'Work through the numbers', prompt: 'Help me understand a weight and balance calculation.' },
];
export function EmptyConversation({ onSuggest }: { onSuggest: (prompt: string) => void }) {
  return <div className="welcome"><div className="welcome-identity"><Brand /><span>YOUR OPERATIONS COPILOT</span></div><h1>A clearer view.<br /><span>A better next step.</span></h1><p>What can I help you work through today?</p><div className="suggestions">{suggestions.map(({ icon: Icon, title, text, prompt }) => <button key={title} onClick={() => onSuggest(prompt)}><Icon size={20} strokeWidth={1.65} /><strong>{title}</strong><span>{text}</span><ArrowUpRight size={14} className="suggestion-arrow" /></button>)}</div></div>;
}
