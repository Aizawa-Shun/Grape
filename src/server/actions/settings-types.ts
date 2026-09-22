export interface SettingsActionState {
  status: "idle" | "error" | "success";
  message?: string;
}

export const initialSettingsActionState: SettingsActionState = { status: "idle" };
