import { getCommandCenterUrl } from '../config/serviceConfig';
import apiClient from './apiClient';

/** One household-sealed config blob, as jarvisd stores it: ciphertext only. */
export interface FleetConfigItem {
  household_id: string;
  config_type: string;
  ciphertext: string;
  nonce: string;
  tag: string;
  revision: number;
}

export interface FleetConfigPutResult {
  config_type: string;
  revision: number;
  nodes_notified: number;
}

const base = (householdId: string): string =>
  `${getCommandCenterUrl()}/api/v0/households/${encodeURIComponent(householdId)}/fleet-config`;

export const listFleetConfig = async (householdId: string): Promise<FleetConfigItem[]> => {
  const res = await apiClient.get<FleetConfigItem[]>(base(householdId));
  return res.data;
};

export const putFleetConfig = async (
  householdId: string,
  configType: string,
  sealed: { ciphertext: string; nonce: string; tag: string },
): Promise<FleetConfigPutResult> => {
  const res = await apiClient.put<FleetConfigPutResult>(
    `${base(householdId)}/${encodeURIComponent(configType)}`,
    sealed,
  );
  return res.data;
};

export const deleteFleetConfig = async (householdId: string, configType: string): Promise<void> => {
  await apiClient.delete(`${base(householdId)}/${encodeURIComponent(configType)}`);
};
