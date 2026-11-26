import { BadgeCheck, Brain, Bug, Calculator, ChartNoAxesCombined, ClipboardList, FileCheck, Globe, Landmark, Palette, SearchCheck, ShieldCheck, Smartphone, Wrench, type LucideIcon } from 'lucide-react';
import type { GroupRolePreset } from '../types/groupRoles';

export const groupRoleIcons: Record<GroupRolePreset, LucideIcon> = {
  implement: Wrench, review: SearchCheck, debug: Bug, 'art-copy': Palette,
  'native-test': Smartphone, clerk: ClipboardList, cybersecurity: ShieldCheck,
  'fund-manager': Landmark, economist: Globe, 'behavioural-analyst': Brain,
  'quant-researcher': Calculator, 'trading-strategist': ChartNoAxesCombined,
  'risk-manager': ShieldCheck, trader: BadgeCheck, 'independent-auditor': FileCheck,
};
