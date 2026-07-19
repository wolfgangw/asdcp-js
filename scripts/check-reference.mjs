// SPDX-License-Identifier: BSD-3-Clause

import { assertReferenceTools } from '../test/helpers/native-tools.js';

const tools = await assertReferenceTools();
console.log(`AS-DCP reference ${tools.version}`);
console.log(`  info:   ${tools.infoPath}`);
console.log(`  unwrap: ${tools.unwrapPath}`);
