/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { protos } from "@google-cloud/notebooks";
import { JupyterServer } from "@vscode/jupyter-extension";
import type vscode from "vscode";
import { GoogleAuthProvider } from "../auth/auth-provider";
import { InputStep, MultiStepInput } from "../common/multi-step-quickpick";
import { WorkbenchInstanceManager } from "../jupyter/workbench-instance-manager";
import { GCPProject, ProjectsClient } from "./projects-client";

import State = protos.google.cloud.notebooks.v2.State;

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
    // 1. Ensure Authentication
    const session = await GoogleAuthProvider.getOrCreateSession(vs);
    if (!session) {
      return undefined;
    }

    let selectedServer: JupyterServer | undefined;

    const pickProject: InputStep = async (input) => {
      let searchTimeout: NodeJS.Timeout | undefined;

      // Initial load
      let initialItems: vscode.QuickPickItem[] = [];
      try {
        const projects = await projectsClient.getProjects("");
        initialItems = projects.map((p: GCPProject) => ({
          label: p.name,
          detail: p.id,
          description: p.id !== p.name ? p.id : undefined,
        }));
      } catch (error) {
        console.error("Failed to fetch initial projects:", error);
      }

      const selected = await input.showQuickPick<vscode.QuickPickItem>({
        title: "Select a Google Cloud Project",
        step: 1,
        totalSteps: 2,
        placeholder: "Select a Google Cloud Project",
        items: initialItems,
        onDidChangeValue: (value, quickPick) => {
          if (searchTimeout) {
            clearTimeout(searchTimeout);
          }
          searchTimeout = setTimeout(() => {
            void (async () => {
              const qp = quickPick as vscode.QuickPick<vscode.QuickPickItem>;
              qp.busy = true;
              try {
                const projects = await projectsClient.getProjects(value);
                qp.items = projects.map((p: GCPProject) => ({
                  label: p.name,
                  detail: p.id,
                  description: p.id !== p.name ? p.id : undefined,
                }));
              } catch (error) {
                console.error("Failed to fetch projects:", error);
              } finally {
                qp.busy = false;
              }
            })().catch((err: unknown) => {
              console.error("Unhanded promise rejection in timeout:", err);
            });
          }, SEARCH_DEBOUNCE_MS);

        },
      });

      const projectId = selected.detail;
      if (projectId) {
        instanceManager.setProjectId(projectId);
        return pickInstance;
      }
      return undefined;
    };

    const pickInstance: InputStep = async (input) => {
      const servers = await instanceManager.loadWorkbenchServers();
      const activeServers = servers.filter((s) => s.state === State.ACTIVE);
      const otherServers = servers.filter((s) => s.state !== State.ACTIVE);

      const items: vscode.QuickPickItem[] = [];

      if (activeServers.length > 0) {
        items.push({
          label: "Active Servers",
          kind: vs.QuickPickItemKind.Separator,
        });
        items.push(
          ...activeServers.map((server) => ({
            label: server.label,
            detail: server.id
          })),
        );
      }

      if (otherServers.length > 0) {
        items.push({
          label: "Inactive Servers",
          kind: vs.QuickPickItemKind.Separator,
        });
        items.push(
          ...otherServers.map((server) => ({
            label: server.label,
            detail: server.id
          })),
        );
      }

      const selectedItem = await input.showQuickPick({
        title: "Select a Workbench Instance",
        step: 2,
        totalSteps: 2,
        placeholder: "Select a Workbench Instance",
        items: items,
        activeItem: items[0],
      });

      const serverId = selectedItem.detail;
      const allServers = instanceManager.getWorkbenchServers("all");
      selectedServer = allServers.find((s) => s.id === serverId);

      if (selectedServer) {
        // Trigger the kernel picker so the user can see the server's kernels
        // immediately
        // await vs.commands.executeCommand("notebook.selectKernel");
      }

      return undefined;
    };

    await MultiStepInput.run(vs, pickProject);
    return selectedServer;
  } catch (error) {
    // If the user cancelled, MultiStepInput throws InputFlowAction.cancel
    // Actually MultiStepInput swallows cancel and returns normally.
    // So if cancelled, selectedServer stays undefined.
    // If error occurs, we show message.
    if (error instanceof Error && error.message === 'cancel') {
      return undefined;
    }

    // We should probably catch other errors
    const errMessage = error instanceof Error ? error.message : String(error);
    if (errMessage !== "cancel") {
      void vs.window.showErrorMessage(
        `Failed to start Workbench flow: ${errMessage}`,
      );
    }
    return undefined;
  }
}
