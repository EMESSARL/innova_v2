# Publication Microfrontend

Ce repo contient le frontend du **Publication Microfrontend**, un composant clé de notre architecture microfrontend. Il permet de publier des données validées dans divers formats (PDF, CSV, Excel, Shapefile, etc.), avec des métadonnées et des autorisations définies par l’utilisateur. Ce microfrontend s’intègre au **Shell Application Microfrontend** pour offrir une expérience utilisateur fluide.

## Fonctionnalités principales
- Sélection du format de publication (PDF, CSV, Excel, Shapefile).
- Ajout de métadonnées (titre, description, domaine, sous-domaine).
- Définition des autorisations (consultation simple ou téléchargeable).
- Gestion des publications existantes (consultation, modification, suppression).

## Technologies utilisées
- **React** : Framework JavaScript pour l’interface utilisateur.
- **React Router** : Gestion de la navigation entre les vues.
- **Axios** : Requêtes HTTP sécurisées vers l’API backend.
- **React Hook Form** : Gestion des formulaires pour la saisie des métadonnées.
- **jsPDF**, **PapaParse**, **SheetJS** : Génération de fichiers dans divers formats.

## Installation
Pour installer et exécuter ce projet localement, suivez ces étapes :

1. Clonez le repo :
   ```bash
   git clone https://github.com/EMESSARL/publication-microfrontend.git
