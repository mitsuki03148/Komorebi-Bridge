import { createContext } from 'react';
import type { GhTarget } from './githubUrl';

/** Opens the GitHub panel at a target. Where nothing provides it, GitHub links open in the browser. */
export const GitHubOpenContext = createContext<((target: GhTarget) => void) | undefined>(undefined);
