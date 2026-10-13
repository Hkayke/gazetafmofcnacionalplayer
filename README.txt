GAZETA FM NACIONAL PLAYER

PUBLICAR NO RENDER
1. Extraia o ZIP e envie os arquivos a um repositório GitHub.
2. Crie um Web Service no Render ligado ao repositório.
3. Build Command: npm install
4. Start Command: npm start
5. Em Environment Variables, defina LOCUTOR_PASSWORD com uma senha forte.
6. Publique e abra a URL fornecida.

USAR
- Abra Painel do Locutor e entre com nome e senha.
- Adicione até 4 músicas e até 10 arquivos de efeitos, vinhetas ou anúncios.
- Use Tocar em uma música específica ou Próxima música para avançar na playlist.
- Efeitos podem tocar por cima da música sem interromper a faixa.
- A mesa separa os volumes de microfone, música, efeitos e volume geral.
- Medidores mostram o nível de música, voz e efeitos separadamente.
- O retorno local opcional reproduz somente a música no dispositivo do locutor, sem a voz. Use fones para evitar eco.
- “Baixar música e próxima” faz uma transição gradual.
- O navegador tenta recuperar o áudio e a conexão após interrupções, e solicita manter a tela ativa quando suportado.

IMPORTANTE SOBRE SEGUNDO PLANO
Esta versão continua sendo uma transmissão WebRTC iniciada pelo navegador. Android/Chrome pode suspender a aba, o microfone ou a rede quando você troca de aplicativo, bloqueia a tela ou economiza bateria. O código agora tenta retomar áudio/reconectar, mas uma página web não pode garantir transmissão contínua quando o sistema a suspende. Para uma rádio que continue transmitindo mesmo com o painel fechado ou o celular em segundo plano, é necessário migrar a arquitetura para um servidor de streaming dedicado (por exemplo, Icecast/SHOUTcast ou serviço de streaming gerenciado) e enviar o áudio a esse servidor.

A conexão WebRTC usa servidor STUN público e pode falhar em algumas redes sem TURN. Arquivos de música/efeitos ficam no dispositivo do locutor e não são enviados para armazenamento no servidor. Use apenas áudio que você tenha autorização para transmitir. Configure LOCUTOR_PASSWORD antes de publicar; a senha padrão de desenvolvimento não é segura.
