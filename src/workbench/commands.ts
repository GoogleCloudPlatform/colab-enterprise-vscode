/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { JupyterServer } from '@vscode/jupyter-extension';
import type vscode from 'vscode';
import { InputStep, MultiStepInput } from '../common/multi-step-quickpick';
import { WorkbenchInstanceManager, WorkbenchJupyterServer } from '../jupyter/workbench-instance-manager';
import { withError } from '../utils/errors';
import { GCPProject, ProjectsClient } from './projects-client';
import { protos } from '@google-cloud/notebooks';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Handles the Workbench project selection command.
 */
export async function selectProjectCommand(
  vs: typeof vscode,
  projectsClient: ProjectsClient,
  instanceManager: WorkbenchInstanceManager,
): Promise<JupyterServer | undefined> {
  try {
    let selectedProject: vscode.QuickPickItem | undefined;
    let selectedServer: JupyterServer | undefined;

    const pickProject: InputStep = async (input) => {
      let searchTimeout: NodeJS.Timeout | undefined;

      // Initial load
      let initialItems: vscode.QuickPickItem[] = [];
      try {
        const projects = await withError(
          /* operation= */() => projectsClient.getProjects(),
          /* defaultValue= */[],
          /* errorMessage= */ 'Failed to fetch initial projects',
        );
        initialItems = projects.map((p: GCPProject) => ({
          label: p.name || p.id,
          detail: p.id,
          // description: p.id !== p.name ? p.id : undefined,
        }));
      } catch (error: unknown) {
        console.error('Failed to fetch initial projects:', error);
      }

      selectedProject = await input.showQuickPick<vscode.QuickPickItem>({
        title: 'Select a Google Cloud Project',

        placeholder: 'Select a Google Cloud Project',
        items: initialItems,
        onDidChangeValue: (value, quickPick) => {
          if (searchTimeout) {
            clearTimeout(searchTimeout);
          }
          searchTimeout = setTimeout(() => {
            const qp = quickPick as vscode.QuickPick<vscode.QuickPickItem>;
            void updateProjectList(projectsClient, qp, value).catch(
              (err: unknown) => {
                console.error('Unhandled promise rejection in timeout:', err);
              },
            );
          }, SEARCH_DEBOUNCE_MS);
        },
      });

      if (selectedProject?.detail) {
        instanceManager.setProjectId(selectedProject.detail);
        instanceManager.setShouldRefresh();
        return pickInstance(selectedProject.detail);
      }

      return undefined;
    };

    const pickInstance = (projectId: string): InputStep => {
      return async (input) => {
        let instances: protos.google.cloud.notebooks.v2.IInstance[] = [];

        await input.showQuickPick<vscode.QuickPickItem>({
          title: 'Select Jupyter Instance',
          placeholder: 'Fetching instances...',
          items: [],
          onDidCreate: (quickPick) => {
            quickPick.busy = true;
            withError(
              () => instanceManager.getWorkbenchServers(),
              [],
              'Failed to list instances',
            ).then((fetchedInstances) => {
              instances = fetchedInstances;
              quickPick.busy = false;
              if (instances.length === 0) {
                quickPick.items = [{
                  label: 'No active instance, please enable them',
                  detail: `Link to project: ${projectId}`,
                }];
              } else {
                quickPick.items = instances.map((instance) => {
                  const name = instance.name?.split('/').pop() || 'Unknown';
                  return {
                    label: `${name} (${projectId})`,
                    description: instance.id || 'Unknown',
                    detail: instance.proxyUri || undefined,
                  };
                });
              }
            }).catch((err: unknown) => {
              console.error('Failed to fetch instances:', err);
              quickPick.busy = false;
              quickPick.items = [{
                label: 'Failed to fetch instances',
                detail: err instanceof Error ? err.message : String(err),
              }];
            });
          }
        }).then((result) => {
          if (result) {
            if (result.label === 'No active instance, please enable them') {
              const url = `https://console.cloud.google.com/vertex-ai/workbench/instances?project=${projectId}`;
              void vs.env.openExternal(vs.Uri.parse(url));
              return;
            }
            const selectedItem = instances.find(i => i.id === result.description || i.name?.split('/').pop() === result.label.split(' ')[0]);
            if (selectedItem) {
              const name = selectedItem.name?.split('/').pop() || 'Unknown';
              selectedServer = {
                id: selectedItem.id || 'Unknown',
                label: `${name} (${projectId})`,
                name: name,
                projectId: projectId,
                proxyUri: selectedItem.proxyUri || '',
              } as WorkbenchJupyterServer;
            }
          }
        });
        return undefined;
      };
    };

    await MultiStepInput.run(vs, pickProject);
    return selectedServer;
  } catch (error: unknown) {
    // If the user cancelled, MultiStepInput throws InputFlowAction.cancel
    // Actually MultiStepInput swallows cancel and returns normally.
    // So if cancelled, selectedServer stays undefined.
    // If error occurs, we show message.
    if (error instanceof Error && error.message === 'cancel') {
      return;
    }

    // We should probably catch other errors
    const errMessage = error instanceof Error ? error.message : String(error);
    if (errMessage === 'cancel') {
      return;
    }
    void vs.window.showErrorMessage(
      `Failed to start Workbench flow: ${errMessage}`,
    );
  }
  return;
}

async function updateProjectList(
  projectsClient: ProjectsClient,
  quickPick: vscode.QuickPick<vscode.QuickPickItem>,
  value: string,
): Promise<void> {
  quickPick.busy = true;
  try {
    const projects = await withError(
      /* operation= */() => projectsClient.getProjects(value),
      /* defaultValue= */[],
      /* errorMessage= */ 'Failed to fetch projects',
    );
    quickPick.items = projects.map((p) => ({
      label: p.name || p.id,
      detail: p.id
    }));
  } catch (error: unknown) {
    console.error('Failed to fetch projects:', error);
  } finally {
    quickPick.busy = false;
  }
}
