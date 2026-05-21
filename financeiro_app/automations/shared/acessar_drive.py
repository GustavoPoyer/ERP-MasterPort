"""
Automação para acessar Google Drive via unidade de rede mapeada
e baixar planilhas modificadas hoje (somente arquivos na raiz da pasta;
subpastas não são percorridas).
Caminho: G:\Drives compartilhados\automação
"""

import os
import sys
import shutil
from datetime import datetime
from pathlib import Path

# Configura encoding para Windows
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# Diretório onde o script está localizado
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Caminho do Google Drive mapeado
DRIVE_PATH = r'G:\Drives compartilhados\automação'

# Extensões de planilhas aceitas
EXTENSOES_PLANILHAS = ['.xlsx', '.xls', '.ods', '.csv', '.xlsm', '.xlsb']


def verificar_caminho_drive():
    """
    Verifica se o caminho do Drive está acessível.
    """
    if not os.path.exists(DRIVE_PATH):
        print(f"[ERRO] Caminho do Drive nao encontrado: {DRIVE_PATH}")
        print("\nVerifique se:")
        print("1. O Google Drive File Stream esta instalado e em execucao")
        print("2. A pasta esta sincronizada")
        print("3. O caminho esta correto")
        return False
    
    if not os.path.isdir(DRIVE_PATH):
        print(f"[ERRO] O caminho nao e uma pasta: {DRIVE_PATH}")
        return False
    
    print(f"[OK] Drive acessivel em: {DRIVE_PATH}")
    return True


def obter_data_hoje():
    """
    Retorna a data de hoje no formato usado para comparação.
    """
    return datetime.now().date()


def arquivo_modificado_hoje(caminho_arquivo):
    """
    Verifica se o arquivo foi modificado hoje.
    """
    try:
        # Obtém a data de modificação do arquivo
        data_modificacao = datetime.fromtimestamp(os.path.getmtime(caminho_arquivo)).date()
        data_hoje = obter_data_hoje()
        
        return data_modificacao == data_hoje
    except Exception as e:
        print(f"  [AVISO] Erro ao verificar data de {caminho_arquivo}: {e}")
        return False


def eh_planilha(nome_arquivo):
    """
    Verifica se o arquivo é uma planilha baseado na extensão.
    """
    extensao = Path(nome_arquivo).suffix.lower()
    return extensao in EXTENSOES_PLANILHAS


def formatar_tamanho(tamanho_bytes):
    """
    Formata o tamanho do arquivo em formato legível.
    """
    if tamanho_bytes is None:
        return "N/A"
    
    for unidade in ['B', 'KB', 'MB', 'GB']:
        if tamanho_bytes < 1024.0:
            return f"{tamanho_bytes:.2f} {unidade}"
        tamanho_bytes /= 1024.0
    return f"{tamanho_bytes:.2f} TB"


def listar_planilhas_hoje(caminho_base):
    """
    Lista apenas planilhas na raiz do caminho (sem subpastas), modificadas hoje.
    Pastas não são percorridas — só arquivos diretamente em automação/.
    """
    planilhas_encontradas = []
    
    print("\n" + "="*80)
    print("BUSCANDO PLANILHAS MODIFICADAS HOJE")
    print("="*80)
    print(f"Procurando em (somente raiz, sem subpastas): {caminho_base}")
    print("="*80 + "\n")
    
    try:
        for nome in os.listdir(caminho_base):
            if nome.startswith('.'):
                continue
            caminho_completo = os.path.join(caminho_base, nome)
            if not os.path.isfile(caminho_completo):
                continue
            if not eh_planilha(nome):
                continue
            if not arquivo_modificado_hoje(caminho_completo):
                continue
            try:
                tamanho = os.path.getsize(caminho_completo)
                data_mod = datetime.fromtimestamp(os.path.getmtime(caminho_completo))
                planilhas_encontradas.append({
                    'nome': nome,
                    'caminho_completo': caminho_completo,
                    'caminho_relativo': nome,
                    'tamanho': tamanho,
                    'data_modificacao': data_mod
                })
                print(f"[ENCONTRADA] {nome}")
                print(f"  Tamanho: {formatar_tamanho(tamanho)}")
                print(f"  Modificado: {data_mod.strftime('%Y-%m-%d %H:%M:%S')}")
                print()
            except Exception as e:
                print(f"  [ERRO] Erro ao processar {nome}: {e}")
        
        return planilhas_encontradas
    
    except Exception as e:
        print(f"[ERRO] Erro ao listar arquivos: {e}")
        return []


def copiar_planilhas(planilhas, pasta_destino):
    """
    Copia as planilhas encontradas para a pasta de destino.
    """
    if not planilhas:
        print("\nNenhuma planilha para copiar.")
        return
    
    # Cria pasta de downloads
    data_hoje = datetime.now().strftime('%Y-%m-%d')
    pasta_hoje = os.path.join(pasta_destino, data_hoje)
    os.makedirs(pasta_hoje, exist_ok=True)
    
    print("\n" + "="*80)
    print(f"COPIANDO PLANILHAS ({len(planilhas)} arquivo(s))")
    print("="*80)
    print(f"Destino: {pasta_hoje}")
    print("="*80 + "\n")
    
    copiados = 0
    erros = []
    
    for i, planilha in enumerate(planilhas, 1):
        nome_arquivo = planilha['nome']
        caminho_origem = planilha['caminho_completo']
        
        print(f"[{i}/{len(planilhas)}] Copiando: {nome_arquivo}")
        
        try:
            # Define caminho de destino
            caminho_destino = os.path.join(pasta_hoje, nome_arquivo)
            
            # Se o arquivo já existe, adiciona timestamp
            if os.path.exists(caminho_destino):
                nome_base, extensao = os.path.splitext(nome_arquivo)
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                nome_novo = f"{nome_base}_{timestamp}{extensao}"
                caminho_destino = os.path.join(pasta_hoje, nome_novo)
                print(f"  [AVISO] Arquivo ja existe, renomeando para: {nome_novo}")
            
            # Copia o arquivo
            shutil.copy2(caminho_origem, caminho_destino)
            
            print(f"  [OK] Copiado para: {os.path.basename(caminho_destino)}")
            copiados += 1
        
        except Exception as e:
            print(f"  [ERRO] Erro ao copiar: {e}")
            erros.append(nome_arquivo)
    
    print("\n" + "="*80)
    print("RESUMO:")
    print(f"  Planilhas copiadas com sucesso: {copiados}")
    print(f"  Erros: {len(erros)}")
    if erros:
        print(f"  Arquivos com erro: {', '.join(erros)}")
    print(f"  Pasta de destino: {pasta_hoje}")
    print("="*80)
    
    return copiados, erros


def main():
    """
    Função principal da automação.
    """
    print("="*80)
    print("AUTOMACAO GOOGLE DRIVE - BAIXAR PLANILHAS DE HOJE")
    print("="*80)
    print(f"Caminho do Drive: {DRIVE_PATH}")
    print(f"Data de hoje: {obter_data_hoje()}")
    print("="*80)
    
    # Verifica se o caminho está acessível
    if not verificar_caminho_drive():
        return
    
    # Lista planilhas modificadas hoje
    planilhas = listar_planilhas_hoje(DRIVE_PATH)
    
    if not planilhas:
        print("\nNenhuma planilha modificada hoje foi encontrada.")
        return
    
    print(f"\nTotal de planilhas encontradas: {len(planilhas)}")
    
    # Cria pasta de downloads
    pasta_downloads = os.path.join(SCRIPT_DIR, 'downloads')
    os.makedirs(pasta_downloads, exist_ok=True)
    
    # Copia as planilhas
    copiados, erros = copiar_planilhas(planilhas, pasta_downloads)
    
    print("\n[OK] Automacao concluida com sucesso!")
    
    if copiados > 0:
        data_hoje = datetime.now().strftime('%Y-%m-%d')
        pasta_hoje = os.path.join(pasta_downloads, data_hoje)
        print(f"\nPlanilhas disponiveis em: {pasta_hoje}")


if __name__ == '__main__':
    main()
