import { createContext, useContext, useState, type Dispatch, type ReactElement, type ReactNode, type SetStateAction } from 'react';
import type { TimelineMenuCommandId, TimelineMenuState } from '../../shared/timelineMenuCommands';

type MenuController = {
  readonly state: TimelineMenuState;
  readonly shortcuts: Readonly<Partial<Record<TimelineMenuCommandId, string>>>;
  readonly run: (command: TimelineMenuCommandId) => void;
};
const ControllerContext = createContext<MenuController | null>(null);
const RegisterContext = createContext<Dispatch<SetStateAction<MenuController | null>> | null>(null);

export function ApplicationMenuProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [controller, setController] = useState<MenuController | null>(null);
  return <RegisterContext.Provider value={setController}><ControllerContext.Provider value={controller}>{children}</ControllerContext.Provider></RegisterContext.Provider>;
}
export const useApplicationMenuController = () => useContext(ControllerContext);
export const useRegisterApplicationMenu = () => useContext(RegisterContext);
