# Ubuntu runtime validation baseline

The locally cached `ubuntu:24.04` image was run with `--rm --network none --read-only` and no host mounts. The image digest and command-availability observations are recorded in `report.json`: Blender, Node, Python and bubblewrap are absent. Docker was available locally; no image pull or package installation was performed.

This establishes a clean userspace target for upcoming bundle tests. It does not validate the installer, modeling, nested namespace support, a full virtual machine, or the portable release. The image shares the host kernel. Future checks must retain these distinctions and identify any added container privileges or prerequisites.
