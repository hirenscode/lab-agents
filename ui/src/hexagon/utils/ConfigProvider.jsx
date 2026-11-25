import React, { createContext, useContext } from "react";
import { designTokens } from "../tokens/designTokens.js";

const Context = createContext(null);
const tokens = {
  ...designTokens,
  colors: { ...designTokens.colors, accent: { ...designTokens.colors.accent, primary: "#5146d9" } },
};

export function ConfigProvider({ children, theme }) {
  return <Context.Provider value={{ theme, designTokens: tokens }}>{children}</Context.Provider>;
}

export const useDesignTokens = () => useContext(Context);
