import { createContext } from 'react';

/** Opens a file in the reader. Where nothing provides it, file paths in messages stay plain code. */
export type FileOpen = ((path: string) => void) & { videoSupported?: boolean };
export const FileOpenContext = createContext<FileOpen | undefined>(undefined);
