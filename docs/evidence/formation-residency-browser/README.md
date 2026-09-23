# Formation residency browser evidence

Result: **passed**.

The fixture ran 120 ready-stage procedural entities through the shared World when WebGL was available, and directly through the software canvas renderer. It checks the 48 resident limit, selected residency, visible-versus-near priority, navigation to the distant cluster and reentry, and captures desktop/mobile viewport screenshots.

WebGL renderer: webgl. Software proxy arcs on the distant view: 3. Provider calls: 0. External requests: 0.

The WebGL run uses SwiftShader. The 390x844 captures are browser viewport emulation. Neither run measures native GPU or physical mobile performance. See [report.json](./report.json) for assertions and renderer snapshots.
