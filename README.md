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

## Conceitos matemáticos

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