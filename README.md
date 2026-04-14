# Vertex AI Workbench VS Code Extension

[Vertex AI Workbench](https://cloud.google.com/vertex-ai/docs/workbench/introduction) instances are Jupyter notebook-based development environments for the entire data science workflow. You can interact with Vertex AI and other Google Cloud services from within a Vertex AI Workbench instance's Jupyter notebook. Built atop
the [Jupyter
extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter),
this extension exposes Workbench Jupyter servers directly in VS Code!

- 👾 [Bug
  report](https://github.com/GoogleCloudPlatform/colab-enterprise-vscode/issues/new?template=bug_report.md)
- ✨ [Feature
  request](https://github.com/GoogleCloudPlatform/colab-enterprise-vscode/issues/new?template=feature_request.md)
- 💬 [Discussions](https://github.com/GoogleCloudPlatform/colab-enterprise-vscode/discussions)

## Quick Start

1. Install [VS Code](https://code.visualstudio.com).
1. Install the Workbench extension from either the [Visual Studio
   Marketplace](https://marketplace.visualstudio.com/items?itemName=googlecloudtools.workbench)
   or [Open VSX](https://open-vsx.org/extension/googlecloudtools/workbench).
1. Install the [Jupyter
   extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter) if not already installed.
1. Open or create a notebook file.
1. Click `Select Kernel` > `Google Cloud` > `Workbench`.
1. When prompted, sign in.
1. Search and select a GCP project.
1. Select an active Workbench instance.
1. 😎 Enjoy!

![Connecting to an active Workbench instance and executing a code
cell](./docs/assets/hello-world.gif)

## Contributing

Contributions are welcome and appreciated! See the [contributing
guide](./docs/contributing.md) for more info.

## Data and Telemetry

The extension does not collect any client-side usage data within VS Code. See
the [Google Cloud Terms of Service](https://cloud.google.com/terms) and the
[Google Cloud Privacy](https://cloud.google.com/privacy)
for more information.

## Security

To mitigate the risk of malicious extensions accessing your OAuth credentials, ensure the extension is installed from a trusted source (such as the [Visual Studio
Marketplace](https://marketplace.visualstudio.com) or [Open VSX](https://open-vsx.org)) and is authored by the **verified publisher (GoogleCloudTools)**.

Please see our [security disclosure process](./SECURITY.md). All [security
advisories](https://github.com/GoogleCloudPlatform/colab-enterprise-vscode/security/advisories) are
managed on GitHub.
