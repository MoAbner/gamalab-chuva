# GamaLab — Distribuição Gama e Chuva

Site para aula de probabilidade: o professor cria uma sala, projeta o QR code e os alunos geram simulações pelo celular. Um histograma coletivo mostra os resultados em comparação com a curva teórica da gama.

## Preparar a aplicação

1. Crie um projeto em https://supabase.com/dashboard
2. Abra SQL Editor e execute o conteúdo integral de supabase/schema.sql.
3. Defina uma senha privada e forte do professor (pelo menos 12 caracteres) no SQL Editor:

~~~sql
update gama_internal.settings
set value = md5('SUA-SENHA-PRIVADA-AQUI')
where key = 'pin_hash';
~~~

4. Copie o Project URL e a chave pública (publishable key) do Supabase. Edite docs/config.js preenchendo supabaseUrl e supabaseKey. Nunca inclua senha, service_role ou chave secreta no GitHub.
5. Abra Settings > Pages no GitHub, escolha Deploy from a branch, main e /docs. Salve.
6. O endereço esperado, depois de habilitar Pages, é https://moabner.github.io/gamalab-chuva/
7. Abra o site, crie uma sala com a senha do professor e teste a participação de dois celulares pelo QR code.

Ao abrir o painel por `localhost`, `127.0.0.1`, `::1` ou como arquivo local, o QR code e o botão de copiar link usam `publicSiteUrl` de `docs/config.js`. Esse endereço deve apontar para a publicação configurada com o mesmo Supabase. Endereços de loopback não são acessíveis por outros dispositivos. Depois de atualizar os arquivos locais, recarregue o painel para gerar o QR novamente.

## Conceitos matemáticos

## Laboratório de Comparação

Abra `docs/comparison.html` ou use **Comparar parâmetros** no site. O botão abre outra aba, preservando a sala coletiva. A comparação funciona sem sala, login ou Supabase e mantém os temas claro e escuro.

- Até três cenários com nome, visibilidade, α e θ próprios; cores e linhas contínua, tracejada e pontilhada identificam as curvas.
- Modos livres, α variável com θ fixo, θ variável com α fixo e mesma média (θ = média / α).
- Limite editável, probabilidades pela CDF Gama, diferenças em pontos percentuais, média αθ, variância αθ² e desvio √α θ.
- Lotes locais de 100, 1.000 ou 5.000 amostras por cenário. Mudar os parâmetros descarta as amostras anteriores. Histogramas usam densidade = contagem / (n × largura do intervalo).
- As curvas usam densidades médias por intervalo, obtidas por diferenças da CDF, evitando desenhar a singularidade em zero para α menor que 1. As probabilidades incluem a cauda além da escala visível, que termina após o quantil 99,7%.

Os cálculos compartilhados estão em `docs/gamma-math.js`: log-gama de Lanczos, CDF por série/fração contínua da gama incompleta regularizada, quantis por bisseção e amostras por Marsaglia–Tsang com transformação para α menor que 1. O módulo não altera o banco nem os parâmetros da sala.

Para validar localmente, sirva `docs/` com seu servidor habitual e teste o botão de comparação, os três modos orientados, os controles e os lotes. Confira também o painel coletivo e dois celulares conectados à mesma sala. No celular, o efeito visual começa ao toque e o texto confirma separadamente o resultado do envio; erros restauram a chuva suave.

Para conferir a tela do aluno sem criar sala, use **Testar tela do aluno e chuva** na página inicial ou abra `index.html?preview=aluno`. Essa prévia usa o mesmo cartão, animação e botões da participação real, mas sorteia amostras apenas no navegador, sem chamadas ao Supabase. O aviso **Prévia local · sem envio** identifica esse modo. A publicação precisa incluir todos os arquivos de `docs/`, inclusive `theme.js`, `gamma-math.js` e os arquivos de comparação; mudanças locais não atualizam automaticamente o GitHub Pages.

Testes automatizados (Node.js 24): `node --test --test-isolation=none tests/comparison.test.cjs`. Eles verificam CDF contra fórmulas conhecidas, inversão dos quantis, momentos amostrais com semente fixa, renderização e modos de comparação em DOM simulado, histogramas, nomes escapados, visibilidade e estados da chuva. A aparência, a leitura por tecnologia assistiva e a sincronização real ainda exigem validação no navegador/dispositivos.

### Modelo do experimento coletivo

No modo Dia chuvoso, os volumes positivos seguem uma distribuição Gama com alfa = 0,8 e teta = 15 mm. Média teórica = alfa × teta = 12 mm. Probabilidade teórica de ultrapassar 30 mm: aproximadamente 9,43%.

O modo Janeiro completo sorteia dias secos e chuvosos, soma os 31 dias e não pressupõe que os totais mensais sigam uma única distribuição gama.

Todos os dados são simulados, não correspondem a previsões meteorológicas reais.

## Sugestão de atividade (10 minutos)

- Projetar QR code e explicar os parâmetros.
- Cada aluno gera 10 experimentos.
- Interpretar a média, o histograma e a frequência acima de 30 mm.
- Cada aluno gera mais 50 experimentos; explicar a aproximação da frequência à probabilidade teórica.
- Como extensão, mostrar janeiro completo com dias secos.

## Acessibilidade e privacidade

A aplicação exibe texto equivalente às principais estatísticas, tabela acessível do histograma, controles por teclado e não solicita nome nem e-mail. Os sorteios da sala coletiva são gerados no backend, com controle de permissões e limites por participante.

## Estado da publicação

Os arquivos do aplicativo e do backend estão neste repositório. Para funcionamento coletivo ainda é necessário configurar o Supabase e habilitar o GitHub Pages. Antes da aula, verifique com dois dispositivos que os resultados chegam ao gráfico da sala.

