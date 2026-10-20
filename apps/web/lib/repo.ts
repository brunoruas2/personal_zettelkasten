import { ZettelRepository } from '@zettelkasten/db-web';
import { ZettelController } from '@zettelkasten/core';

// Singletons do acesso a dados. Ficam num módulo próprio (e não no
// DatabaseProvider) para o download de corpos e o cache poderem usá-los sem
// importar o provider.
export const repo = new ZettelRepository();
export const controller = new ZettelController(repo);
