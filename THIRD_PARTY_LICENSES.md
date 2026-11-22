# Third-party licenses

[Back to README.md](README.md)

This file lists the licenses of every package in the **production** dependency tree of this repository's published packages (`raiminiscence-mcp`, `raiminiscence-hooks`, `raiminiscence-cli`, `raiminiscence-argv`), including transitive dependencies. None of them is bundled: npm installs them alongside the package. `devDependencies` (ESLint, Prettier, Vitest, semantic-release, and so on) are used to build and test this project but are never distributed with it, so they are not listed.

This file is generated - do not hand-edit it. Regenerate it with:

```bash
pnpm run licenses:generate
```

CI runs the same script with `--check` and fails the build if this file is stale, or if a production dependency's license isn't on the generator's reviewed list - see `.github/workflows/ci.yml`.

All 156 platform-independent packages in the production tree use a permissive license (Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MIT). The platform-specific binaries below are listed separately.

## Direct dependencies

The packages the published packages' own `package.json` files depend on directly, peer dependencies included.

| Package | Version | License | Copyright |
| --- | --- | --- | --- |
| @huggingface/transformers | 4.3.0 | Apache-2.0 | Hugging Face |
| @opentelemetry/api | 1.9.1 | Apache-2.0 | OpenTelemetry Authors |
| smol-toml | 1.9.1 | BSD-3-Clause | Cynthia Rey |
| @modelcontextprotocol/sdk | 1.32.1 | MIT | Anthropic, PBC |
| gray-matter | 4.0.3 | MIT | Jon Schlinkert |
| pino | 10.3.1 | MIT | Matteo Collina |
| ulid | 3.0.2 | MIT | Alizain Feerasta |
| zod | 4.6.7 | MIT | Colin McDonnell |

## Platform-specific native binaries

Installed once per platform, so only the current machine's variant is ever present. Reviewed by hand in `scripts/generate-third-party-licenses.mjs`.

| Package | License | Note |
| --- | --- | --- |
| @img/sharp-libvips-<platform> | LGPL-3.0-or-later | The libvips image library, prebuilt and loaded at runtime by `sharp`. Pulled in by `@huggingface/transformers` (the Embedded Provider). LGPL applies to libvips itself; it is not linked into, or redistributed with, this project's own code. |
| @img/sharp-<platform> | Apache-2.0 | The prebuilt native `sharp` binding for the current platform. |

## Full production dependency tree

Every platform-independent package resolved into the production tree (direct and transitive), as installed by `pnpm-lock.yaml`. A dash in the Copyright column means the package's own metadata does not declare an author.

| Package | Version | License | Copyright |
| --- | --- | --- | --- |
| @huggingface/tokenizers | 0.2.0 | Apache-2.0 | Hugging Face |
| @huggingface/transformers | 4.3.0 | Apache-2.0 | Hugging Face |
| @opentelemetry/api | 1.9.1 | Apache-2.0 | OpenTelemetry Authors |
| detect-libc | 2.1.2 | Apache-2.0 | Lovell Fuller |
| flatbuffers | 25.9.23 | Apache-2.0 | The FlatBuffers project |
| long | 5.3.2 | Apache-2.0 | Daniel Wirtz |
| sharp | 0.35.5 | Apache-2.0 | Lovell Fuller |
| esprima | 4.0.1 | BSD-2-Clause | Ariya Hidayat |
| json-schema-typed | 8.0.2 | BSD-2-Clause | Remy Rylan |
| @protobufjs/aspromise | 1.1.2 | BSD-3-Clause | Daniel Wirtz |
| @protobufjs/base64 | 1.1.2 | BSD-3-Clause | Daniel Wirtz |
| @protobufjs/codegen | 2.0.5 | BSD-3-Clause | Daniel Wirtz |
| @protobufjs/eventemitter | 1.1.1 | BSD-3-Clause | Daniel Wirtz |
| @protobufjs/fetch | 1.1.1 | BSD-3-Clause | Daniel Wirtz |
| @protobufjs/float | 1.0.2 | BSD-3-Clause | Daniel Wirtz |
| @protobufjs/path | 1.1.2 | BSD-3-Clause | Daniel Wirtz |
| @protobufjs/pool | 1.1.0 | BSD-3-Clause | Daniel Wirtz |
| @protobufjs/utf8 | 1.1.2 | BSD-3-Clause | Daniel Wirtz |
| fast-uri | 4.2.3 | BSD-3-Clause | Vincent Le Goff |
| global-agent | 4.1.3 | BSD-3-Clause | Gajus Kuizinas |
| protobufjs | 7.6.6 | BSD-3-Clause | Daniel Wirtz |
| qs | 6.17.1 | BSD-3-Clause | - |
| smol-toml | 1.9.1 | BSD-3-Clause | Cynthia Rey |
| sprintf-js | 1.0.3 | BSD-3-Clause | Alexandru Marasteanu |
| guid-typescript | 1.0.9 | ISC | nicolas |
| inherits | 2.0.4 | ISC | - |
| isexe | 2.0.0 | ISC | Isaac Z. Schlueter |
| once | 1.4.0 | ISC | Isaac Z. Schlueter |
| semver | 7.8.5 | ISC | GitHub Inc. |
| setprototypeof | 1.2.0 | ISC | Wes Todd |
| split2 | 4.2.0 | ISC | Matteo Collina |
| which | 2.0.2 | ISC | Isaac Z. Schlueter |
| wrappy | 1.0.2 | ISC | Isaac Z. Schlueter |
| zod-to-json-schema | 3.25.2 | ISC | Stefan Terdell |
| @hono/node-server | 2.1.11 | MIT | Yusuke Wada |
| @huggingface/jinja | 0.5.10 | MIT | Hugging Face |
| @img/colour | 1.1.0 | MIT | - |
| @modelcontextprotocol/sdk | 1.32.1 | MIT | Anthropic, PBC |
| @pinojs/redact | 0.4.0 | MIT | Matteo Collina |
| @types/node | 22.20.2 | MIT | - |
| accepts | 2.0.0 | MIT | - |
| adm-zip | 0.6.1 | MIT | Nasca Iacob |
| ajv | 8.20.0 | MIT | Evgeny Poberezkin |
| ajv-formats | 3.0.1 | MIT | Evgeny Poberezkin |
| argparse | 1.0.10 | MIT | - |
| atomic-sleep | 1.0.0 | MIT | David Mark Clements |
| body-parser | 2.4.0 | MIT | - |
| bytes | 3.1.2 | MIT | TJ Holowaychuk |
| call-bind-apply-helpers | 1.0.2 | MIT | Jordan Harband |
| call-bound | 1.0.4 | MIT | Jordan Harband |
| content-disposition | 1.1.0 | MIT | Douglas Christopher Wilson |
| content-type | 1.0.5,2.1.0 | MIT | Douglas Christopher Wilson |
| cookie | 0.7.2 | MIT | Roman Shtylman |
| cookie-signature | 1.2.2 | MIT | TJ Holowaychuk |
| cors | 2.8.6 | MIT | Troy Goode |
| cross-spawn | 7.0.6 | MIT | André Cruz |
| debug | 4.4.3 | MIT | Josh Junon |
| define-data-property | 1.1.4 | MIT | Jordan Harband |
| define-properties | 1.2.1 | MIT | Jordan Harband |
| depd | 2.0.0 | MIT | Douglas Christopher Wilson |
| dunder-proto | 1.0.1 | MIT | Jordan Harband |
| ee-first | 1.1.1 | MIT | Jonathan Ong |
| encodeurl | 2.0.0 | MIT | - |
| es-define-property | 1.0.1 | MIT | Jordan Harband |
| es-errors | 1.3.0 | MIT | Jordan Harband |
| es-object-atoms | 1.1.2 | MIT | Jordan Harband |
| escape-html | 1.0.3 | MIT | - |
| escape-string-regexp | 4.0.0 | MIT | Sindre Sorhus |
| etag | 1.8.1 | MIT | - |
| eventsource | 3.0.7 | MIT | Espen Hovlandsdal |
| eventsource-parser | 3.1.1 | MIT | Espen Hovlandsdal |
| express | 5.2.1 | MIT | TJ Holowaychuk |
| express-rate-limit | 8.7.0 | MIT | Nathan Friedly |
| extend-shallow | 2.0.1 | MIT | Jon Schlinkert |
| fast-deep-equal | 3.1.3 | MIT | Evgeny Poberezkin |
| finalhandler | 2.1.1 | MIT | Douglas Christopher Wilson |
| forwarded | 0.2.0 | MIT | - |
| fresh | 2.0.0 | MIT | TJ Holowaychuk |
| function-bind | 1.1.2 | MIT | Raynos |
| get-intrinsic | 1.3.0 | MIT | Jordan Harband |
| get-proto | 1.0.1 | MIT | Jordan Harband |
| globalthis | 1.0.4 | MIT | Jordan Harband |
| gopd | 1.2.0 | MIT | Jordan Harband |
| gray-matter | 4.0.3 | MIT | Jon Schlinkert |
| has-flag | 4.0.0 | MIT | Sindre Sorhus |
| has-property-descriptors | 1.0.2 | MIT | Jordan Harband |
| has-symbols | 1.1.0 | MIT | Jordan Harband |
| hasown | 2.0.4 | MIT | Jordan Harband |
| hono | 4.13.19 | MIT | Yusuke Wada |
| http-errors | 2.0.1 | MIT | Jonathan Ong |
| iconv-lite | 0.7.3 | MIT | Alexander Shtuchkin |
| ip-address | 10.7.4 | MIT | Beau Gunderson |
| ipaddr.js | 1.9.1 | MIT | whitequark |
| is-extendable | 0.1.1 | MIT | Jon Schlinkert |
| is-promise | 4.0.0 | MIT | ForbesLindesay |
| jose | 6.2.12 | MIT | Filip Skokan |
| js-yaml | 3.15.2 | MIT | Vladimir Zapparov |
| json-schema-traverse | 1.0.0 | MIT | Evgeny Poberezkin |
| kind-of | 6.0.3 | MIT | Jon Schlinkert |
| matcher | 4.0.0 | MIT | Sindre Sorhus |
| math-intrinsics | 1.1.0 | MIT | Jordan Harband |
| media-typer | 1.1.1 | MIT | Douglas Christopher Wilson |
| merge-descriptors | 2.0.0 | MIT | - |
| mime-db | 1.54.0 | MIT | - |
| mime-types | 3.0.2 | MIT | - |
| ms | 2.1.3 | MIT | - |
| negotiator | 1.1.0 | MIT | - |
| object-assign | 4.1.1 | MIT | Sindre Sorhus |
| object-inspect | 1.13.4 | MIT | James Halliday |
| object-keys | 1.1.1 | MIT | Jordan Harband |
| on-exit-leak-free | 2.1.2 | MIT | Matteo Collina |
| on-finished | 2.4.1 | MIT | - |
| onnxruntime-common | 1.30.0,1.31.0-dev.20260911-2a43ec07e | MIT | fs-eire |
| onnxruntime-node | 1.30.0 | MIT | fs-eire |
| onnxruntime-web | 1.31.0-dev.20260914-8d85527a0 | MIT | fs-eire |
| parseurl | 1.3.3 | MIT | - |
| path-key | 3.1.1 | MIT | Sindre Sorhus |
| path-to-regexp | 8.4.2 | MIT | - |
| pino | 10.3.1 | MIT | Matteo Collina |
| pino-abstract-transport | 3.0.0 | MIT | Matteo Collina |
| pino-std-serializers | 7.1.0 | MIT | James Sumners |
| pkce-challenge | 5.0.1 | MIT | crouchcd |
| platform | 1.3.6 | MIT | Benjamin Tan |
| process-warning | 5.1.0 | MIT | Tomas Della Vedova |
| proxy-addr | 2.0.8 | MIT | Douglas Christopher Wilson |
| quick-format-unescaped | 4.0.4 | MIT | David Mark Clements |
| range-parser | 1.3.0 | MIT | TJ Holowaychuk |
| raw-body | 3.0.2 | MIT | Jonathan Ong |
| real-require | 0.2.0,1.0.0 | MIT | Paolo Insogna |
| require-from-string | 2.0.2 | MIT | Vsevolod Strukchinsky |
| router | 2.2.0 | MIT | Douglas Christopher Wilson |
| safe-stable-stringify | 2.5.0 | MIT | Ruben Bridgewater |
| safer-buffer | 2.1.2 | MIT | Nikita Skovoroda |
| section-matter | 1.0.0 | MIT | Jon Schlinkert |
| send | 1.2.1 | MIT | TJ Holowaychuk |
| serialize-error | 8.1.0 | MIT | Sindre Sorhus |
| serve-static | 2.2.1 | MIT | Douglas Christopher Wilson |
| shebang-command | 2.0.0 | MIT | Kevin Mårtensson |
| shebang-regex | 3.0.0 | MIT | Sindre Sorhus |
| side-channel | 1.1.1 | MIT | Jordan Harband |
| side-channel-list | 1.0.1 | MIT | Jordan Harband |
| side-channel-map | 1.0.1 | MIT | Jordan Harband |
| side-channel-weakmap | 1.0.2 | MIT | Jordan Harband |
| sonic-boom | 4.2.1 | MIT | Matteo Collina |
| statuses | 2.0.2 | MIT | - |
| strip-bom-string | 1.0.0 | MIT | Jon Schlinkert |
| supports-color | 7.2.0 | MIT | Sindre Sorhus |
| thread-stream | 4.2.0 | MIT | Matteo Collina |
| toidentifier | 1.0.1 | MIT | Douglas Christopher Wilson |
| type-fest | 0.20.2 | MIT | Sindre Sorhus |
| type-is | 2.1.0 | MIT | - |
| ulid | 3.0.2 | MIT | Alizain Feerasta |
| undici-types | 6.21.0 | MIT | - |
| unpipe | 1.0.0 | MIT | Douglas Christopher Wilson |
| vary | 1.1.2 | MIT | Douglas Christopher Wilson |
| zod | 4.6.7 | MIT | Colin McDonnell |

## License texts

Each permissive license's full terms require the text below plus the copyright line(s) for the specific package - see the Copyright column in the tables above for the holder that applies to each package. Where only one package in the tree uses a license, its license file is reproduced verbatim, copyright line included.

### Apache-2.0

Applies to all 7 Apache-2.0 packages in the table above, with the copyright line(s) from the table above substituted per package.

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### BSD-2-Clause

Applies to: esprima, json-schema-typed, with the copyright line(s) from the table above substituted per package.

```text
Copyright (c) <year> <copyright holder>
All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### BSD-3-Clause

Applies to all 15 BSD-3-Clause packages in the table above, with the copyright line(s) from the table above substituted per package.

```text
Copyright (c) <year> <copyright holder>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

* Redistributions of source code must retain the above copyright
  notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright
  notice, this list of conditions and the following disclaimer in the
  documentation and/or other materials provided with the distribution.
* Neither the name of its author, nor the names of its contributors
  may be used to endorse or promote products derived from this software
  without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### ISC

Applies to all 10 ISC packages in the table above, with the copyright line(s) from the table above substituted per package.

```text
Copyright (c) <copyright holder>

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

### MIT

Applies to all 122 MIT packages in the table above, with the copyright line(s) from the table above substituted per package.

```text
MIT License

Copyright (c) <year> <copyright holder>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
