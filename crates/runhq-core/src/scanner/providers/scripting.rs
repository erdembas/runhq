use std::path::Path;

use super::super::{dir_name, ProjectCandidate, RuntimeProvider, Suggestion};

// ---- Python provider -----------------------------------------------------

pub(super) struct PythonProvider;

impl RuntimeProvider for PythonProvider {
    fn label(&self) -> &'static str {
        "python"
    }

    fn detect(&self, dir: &Path) -> Option<ProjectCandidate> {
        let has_pyproject = dir.join("pyproject.toml").is_file();
        let has_setup_py = dir.join("setup.py").is_file();
        let has_manage = dir.join("manage.py").is_file();
        let has_requirements = dir.join("requirements.txt").is_file();
        let has_main = dir.join("main.py").is_file() || dir.join("app.py").is_file();

        if !has_pyproject && !has_setup_py && !has_manage && !has_requirements && !has_main {
            return None;
        }

        let name = dir_name(dir);

        let mut suggestions = Vec::new();

        if has_manage {
            suggestions.push(Suggestion {
                label: "runserver".into(),
                cmd: "python manage.py runserver".into(),
            });
            suggestions.push(Suggestion {
                label: "migrate".into(),
                cmd: "python manage.py migrate".into(),
            });
        }

        if has_main {
            suggestions.push(Suggestion {
                label: "run main".into(),
                cmd: "python main.py".into(),
            });
        }

        if dir.join("app.py").exists() && !has_main {
            suggestions.push(Suggestion {
                label: "run app".into(),
                cmd: "python app.py".into(),
            });
        }

        if dir.join("flask_app.py").exists() {
            suggestions.push(Suggestion {
                label: "flask run".into(),
                cmd: "flask run".into(),
            });
        }

        if dir.join("Makefile").is_file() {
            suggestions.push(Suggestion {
                label: "make".into(),
                cmd: "make".into(),
            });
        }

        if dir.join("docker-compose.yml").is_file() || dir.join("docker-compose.yaml").is_file() {
            suggestions.push(Suggestion {
                label: "docker compose up".into(),
                cmd: "docker compose up".into(),
            });
        }

        if has_pyproject {
            if dir.join("uv.lock").exists() {
                suggestions.push(Suggestion {
                    label: "uv run".into(),
                    cmd: "uv run".into(),
                });
            } else if dir.join("poetry.lock").exists() {
                suggestions.push(Suggestion {
                    label: "poetry run".into(),
                    cmd: "poetry run python".into(),
                });
            }
        }

        if suggestions.is_empty() {
            return None;
        }

        Some(ProjectCandidate {
            name,
            cwd: dir.to_path_buf(),
            runtime: "python",
            suggestions,
            package_manager: None,
            project_name: None,
        })
    }
}

// ---- Ruby provider -------------------------------------------------------

pub(super) struct RubyProvider;

impl RuntimeProvider for RubyProvider {
    fn label(&self) -> &'static str {
        "ruby"
    }

    fn detect(&self, dir: &Path) -> Option<ProjectCandidate> {
        let has_gemfile = dir.join("Gemfile").is_file();
        let has_rakefile = dir.join("Rakefile").is_file();
        let has_rb_main = dir.join("main.rb").is_file() || dir.join("app.rb").is_file();

        if !has_gemfile && !has_rakefile && !has_rb_main {
            return None;
        }

        let name = dir_name(dir);
        let mut suggestions = Vec::new();

        if dir.join("config.ru").is_file() {
            suggestions.push(Suggestion {
                label: "rackup".into(),
                cmd: "bundle exec rackup".into(),
            });
        }

        if dir.join("config/routes.rb").is_file() || dir.join("bin/rails").is_file() {
            suggestions.push(Suggestion {
                label: "rails server".into(),
                cmd: "bundle exec rails server".into(),
            });
            suggestions.push(Suggestion {
                label: "rails console".into(),
                cmd: "bundle exec rails console".into(),
            });
        }

        if has_rakefile {
            suggestions.push(Suggestion {
                label: "rake".into(),
                cmd: "bundle exec rake".into(),
            });
        }

        if dir.join("main.rb").is_file() {
            suggestions.push(Suggestion {
                label: "run main".into(),
                cmd: "ruby main.rb".into(),
            });
        }

        if dir.join("app.rb").is_file() {
            suggestions.push(Suggestion {
                label: "run app".into(),
                cmd: "ruby app.rb".into(),
            });
        }

        if has_gemfile {
            suggestions.push(Suggestion {
                label: "install".into(),
                cmd: "bundle install".into(),
            });
        }

        if suggestions.is_empty() {
            return None;
        }

        Some(ProjectCandidate {
            name,
            cwd: dir.to_path_buf(),
            runtime: "ruby",
            suggestions,
            package_manager: None,
            project_name: None,
        })
    }
}

// ---- PHP provider --------------------------------------------------------

pub(super) struct PhpProvider;

impl RuntimeProvider for PhpProvider {
    fn label(&self) -> &'static str {
        "php"
    }

    fn detect(&self, dir: &Path) -> Option<ProjectCandidate> {
        let has_composer = dir.join("composer.json").is_file();
        let has_artisan = dir.join("artisan").is_file();
        let has_index = dir.join("index.php").is_file();
        let has_public_index = dir.join("public/index.php").is_file();

        if !has_composer && !has_artisan && !has_index && !has_public_index {
            return None;
        }

        let name = dir_name(dir);

        let mut suggestions = Vec::new();

        if has_artisan {
            suggestions.push(Suggestion {
                label: "serve".into(),
                cmd: "php artisan serve".into(),
            });
            suggestions.push(Suggestion {
                label: "migrate".into(),
                cmd: "php artisan migrate".into(),
            });
            suggestions.push(Suggestion {
                label: "test".into(),
                cmd: "php artisan test".into(),
            });
        }

        if has_public_index {
            suggestions.push(Suggestion {
                label: "built-in server".into(),
                cmd: "php -S localhost:8000 -t public".into(),
            });
        } else if has_index && !has_artisan {
            suggestions.push(Suggestion {
                label: "built-in server".into(),
                cmd: "php -S localhost:8000".into(),
            });
        }

        if has_composer {
            suggestions.push(Suggestion {
                label: "install".into(),
                cmd: "composer install".into(),
            });
        }

        if dir.join("vendor/bin/phpunit").exists() {
            suggestions.push(Suggestion {
                label: "phpunit".into(),
                cmd: "vendor/bin/phpunit".into(),
            });
        }

        if suggestions.is_empty() {
            return None;
        }

        Some(ProjectCandidate {
            name,
            cwd: dir.to_path_buf(),
            runtime: "php",
            suggestions,
            package_manager: None,
            project_name: None,
        })
    }
}
