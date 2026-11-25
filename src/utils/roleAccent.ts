import type { CLIModelId } from '../types/guild';

/**
 * Each role's colours: a dusty tone with a little rose in it, so the three feel like one family
 * while staying easy to tell apart. `name` is for text, `stripe` for the bubble's edge, `wash` a barely-there tint.
 */
export const roleAccent: Record<CLIModelId, {
  name: string;
  stripe: string;
  wash: string;
  soft: string;
  mic: string;
  darkName: string;
  darkStripe: string;
  darkWash: string;
  send: { from: string; to: string; shadow: string };
  sendDisabled: { from: string; to: string };
}> = {
  AGY: {
    name: '#C46F7F',
    stripe: '#E3A0AC',
    wash: '#FFF8F9',
    soft: '#FDECEF',
    mic: '#A07583',
    darkName: '#EFA4B2',
    darkStripe: '#D67C8E',
    darkWash: '#241B29',
    send: { from: '#D88B96', to: '#C2707D', shadow: 'rgba(176,92,106,0.6)' },
    sendDisabled: { from: '#E9DADB', to: '#E0CFD1' },
  },
  CODEX: {
    name: '#7A9580',
    stripe: '#B9CDB7',
    wash: '#F9FFF9',
    soft: '#ECF3EC',
    mic: '#6E8874',
    darkName: '#A7CCB0',
    darkStripe: '#7FA889',
    darkWash: '#1A2424',
    send: { from: '#8FAE95', to: '#6F8F77', shadow: 'rgba(95,128,104,0.6)' },
    sendDisabled: { from: '#DCE4DD', to: '#D1DDD3' },
  },
  CLAUDE: {
    name: '#7C80B0',
    stripe: '#B9BCDF',
    wash: '#F9F9FD',
    soft: '#EEF0FA',
    mic: '#7377A2',
    darkName: '#B0B4E6',
    darkStripe: '#8488C4',
    darkWash: '#1C2036',
    send: { from: '#9396C8', to: '#7478AE', shadow: 'rgba(98,102,160,0.6)' },
    sendDisabled: { from: '#DCDDE9', to: '#D1D3E3' },
  },
};
