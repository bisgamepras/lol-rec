# lol rec

Site de salas online com chat em tempo real e compartilhamento de tela.

## Requisitos
- Node.js 18 ou superior
- Um serviço de hospedagem que rode aplicações Node.js
- HTTPS no endereço publicado (necessário para compartilhar tela fora do localhost)

## Rodar no seu computador
1. Instale o Node.js: https://nodejs.org/
2. Extraia o projeto.
3. Abra o terminal dentro da pasta `lol-rec`.
4. Execute:

   ```bash
   npm install
   npm start
   ```

5. Abra http://localhost:3000

Para testar com amigos em locais diferentes, publique o projeto em um host Node.js com HTTPS.

## Publicar na internet
Uma opção é criar um serviço Web no Render:
1. Envie esta pasta para um repositório GitHub.
2. No Render, crie um **Web Service** conectado ao repositório.
3. Build command: `npm install`
4. Start command: `npm start`
5. Publique. O Render fornece um endereço HTTPS.
6. Compartilhe o endereço e o mesmo código de sala com seus amigos.

Use um serviço que suporte conexões WebSocket. Não configure o serviço como site estático.

## Como usar
- Cada pessoa abre o mesmo endereço do site.
- Digitem o mesmo código de sala e nomes diferentes.
- A primeira pessoa que clicar em “Compartilhar tela” escolhe uma janela, aba ou tela.
- As mensagens aparecem para todos na sala.
- Limite atual: 12 pessoas por sala.

## Observações
- O chat e a sinalização WebRTC passam pelo servidor. O vídeo/tela é transmitido diretamente entre os navegadores (P2P), não fica gravado no servidor.
- O compartilhamento depende do navegador, das permissões e da rede de cada participante. Algumas redes/firewalls podem exigir um serviço TURN para conexão WebRTC mais confiável.
- O servidor de exemplo não tem contas, senha de sala, moderação ou armazenamento de mensagens. Não use códigos fáceis se a sala precisar ser privada.
- Compartilhe somente conteúdo que você tem autorização para mostrar.